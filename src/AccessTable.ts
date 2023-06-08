import createDebug from 'debug'

import type { TableObject } from './TableObject'
import {
  MEMO,
  parseDataPageHeader,
  parseRelativeObjectMetadataStruct,
  parseTableData,
  parseTableHead,
  TDEF_HEADER,
} from './parsing-primitives'
import type { Column, PropType, TableHeader } from './parsing-primitives'
import type { ALL_VERSIONS, Dict, PossibleTypes } from './types'
import { DataType, parseType } from './utils'

const debug = createDebug('access-db-parser:AccessTable')

export class AccessTable {
  private parsedTable: Dict<Array<PossibleTypes>> = {}
  private columns: Dict<Column>
  private tableHeader: TableHeader
  public constructor(
    private table: TableObject,
    private version: ALL_VERSIONS,
    private pageSize: number,
    private dataPages: Dict<Buffer>,
    private tableDefs: Dict<Buffer>,
    private textEncoding: BufferEncoding,
    private sanitizeTextBuffer?: (buffer: Buffer) => Buffer
  ) {
    ;[this.columns, this.tableHeader] = this.getTableColumns()
  }

  private getTableColumns(): [Dict<Column>, TableHeader] {
    let tableHeader: TableHeader
    let colNames: PropType<ReturnType<typeof parseTableData>, 'columnNames'>
    let columns: Array<Column>
    try {
      tableHeader = parseTableHead(this.table.value, this.version)
      let mergedData = this.table.value.slice(tableHeader.tDefHeaderEnd)
      if (tableHeader.TDEF_header.nextPagePtr) {
        mergedData = Buffer.concat([mergedData, this.mergeTableData(tableHeader.TDEF_header.nextPagePtr)])
      }
      const parsedData = parseTableData(mergedData, tableHeader.realIndexCount, tableHeader.columnCount, this.version)
      columns = parsedData.column as any
      colNames = parsedData.columnNames
      // REMOVE FOR NOW
      // (tableHeader as any).column = parsedData.column;
      // (tableHeader as any).columnNames = parsedData.columnNames;
    } catch (err) {
      throw new Error(`Failed to parse table header`)
    }
    // const colNames = tableHeader.columnNames;
    // const columns = tableHeader.column;
    columns.forEach((column, index) => {
      column.colNameStr = colNames[index].colNameStr
    })
    const offset = Math.min(...columns.map(c => c.columnIndex))
    const columnDict: Dict<Column> = {}
    for (const x of columns) columnDict[x.columnIndex - offset] = x
    if (Object.keys(columnDict).length !== columns.length) {
      for (const x of columns) columnDict[x.columnID] = x
    }
    if (Object.keys(columnDict).length !== tableHeader.columnCount)
      throw new Error(`Expected ${tableHeader.columnCount} columns got ${Object.keys(columnDict).length}`)
    return [columnDict, tableHeader]
  }

  private mergeTableData(firstPage: number): Buffer {
    let table = this.tableDefs[firstPage * this.pageSize]!
    let parsedHeader = TDEF_HEADER.parse(table)
    let data = table.slice(parsedHeader.headerEnd)
    while (parsedHeader.nextPagePtr) {
      table = this.tableDefs[parsedHeader.nextPagePtr * this.pageSize]!
      parsedHeader = TDEF_HEADER.parse(table)
      data = Buffer.concat([data, table.slice(parsedHeader.headerEnd)])
    }
    return data
  }

  private createEmptyTable() {
    const parsedTable: Dict<Array<PossibleTypes>> = {}
    const [columns] = this.getTableColumns()
    for (const i of Object.keys(columns)) {
      const column = columns[i]!
      parsedTable[column.colNameStr] = []
    }
    return parsedTable
  }

  private getOverflowRecord(recordPointer: number): Buffer | undefined {
    const recordOffset = (recordPointer & 0xff) >>> 0
    const pageNum = recordPointer >>> 8
    const recordPage = this.dataPages[pageNum * this.pageSize]
    if (!recordPage) return
    const parsedData = parseDataPageHeader(recordPage, this.version)
    if (recordOffset > parsedData.recordOffsets.length) return
    let start = parsedData.recordOffsets[recordOffset]
    if ((start & 0x8000) >>> 0) start = (start & 0xfff) >>> 0
    else debug(`Overflow record flag is not present ${start}`)
    let record: Buffer
    if (recordOffset === 0) {
      record = recordPage.slice(start)
    } else {
      let end = parsedData.recordOffsets[recordOffset - 1]
      if (end & 0x8000 && (end & 0xff) !== 0) {
        end &= 0xfff
      }
      record = recordPage.slice(start, end)
    }
    return record
  }

  private parseFixedLengthData(originalRecord: Buffer, column: Column, nullTable: Array<boolean>) {
    const columnName = column.colNameStr
    let parsedType: PossibleTypes
    if (column.type === DataType.Boolean) {
      if (column.columnID > nullTable.length)
        throw new Error(
          `Failed to parse bool field, Column not found in nullTable column: ${columnName}, column id: ${column.columnID}, nullTable: ${nullTable}`
        )
      parsedType = nullTable[column.columnID]
    } else {
      if (column.fixedOffset > originalRecord.length)
        throw new Error(`Column offset is bigger than the length of the record ${column.fixedOffset}`)
      const record = originalRecord.slice(column.fixedOffset)
      parsedType = parseType(column.type, record, this.version, undefined, this.textEncoding, this.sanitizeTextBuffer)
    }
    if (this.parsedTable[columnName] === undefined) this.parsedTable[columnName] = []
    this.parsedTable[columnName]!.push(parsedType)
    return parsedType
  }

  private parseDynamicLengthRecordsMetadata(reverseRecord: Buffer, originalRecord: Buffer, nullTableLength: number) {
    if (this.version > 3) {
      reverseRecord = reverseRecord.slice(nullTableLength + 1)
      if (reverseRecord.length > 1 && reverseRecord[0] === 0) reverseRecord = reverseRecord.slice(1)
      return parseRelativeObjectMetadataStruct(reverseRecord, undefined, this.version)
    }
    const variableLengthJumpTableCNT = Math.floor((originalRecord.length - 1) / 256)
    reverseRecord = reverseRecord.slice(nullTableLength)
    let relativeRecordMetadata: ReturnType<typeof parseRelativeObjectMetadataStruct>
    try {
      relativeRecordMetadata = parseRelativeObjectMetadataStruct(reverseRecord, variableLengthJumpTableCNT, this.version)
      relativeRecordMetadata.relativeMetadataEnd += nullTableLength
    } catch {
      throw new Error('Failed parsing record')
    }
    if (relativeRecordMetadata && relativeRecordMetadata.variableLengthFieldCount !== this.tableHeader.variableColumns) {
      const tmpBuffer = Buffer.allocUnsafe(2)
      tmpBuffer.writeUInt16LE(this.tableHeader.variableColumns)
      const metadataStart = reverseRecord.indexOf(tmpBuffer)
      if (metadataStart !== 1 && metadataStart < 10) {
        reverseRecord = reverseRecord.slice(metadataStart)
        try {
          relativeRecordMetadata = parseRelativeObjectMetadataStruct(reverseRecord, variableLengthJumpTableCNT, this.version)
        } catch {
          throw new Error(`Failed to parse record metadata: ${originalRecord}`)
        }
        relativeRecordMetadata.relativeMetadataEnd += metadataStart
      } else {
        debug(
          `Record did not parse correctly. Number of columns: ${this.tableHeader.variableColumns}. Number of parsed columns: ${relativeRecordMetadata.variableLengthFieldCount}`
        )
        return
      }
    }
    return relativeRecordMetadata
  }

  private parseMemo(relativeObjData: Buffer) {
    debug(`Parsing memo field ${relativeObjData}`)
    const parsedMemo = MEMO.parse(relativeObjData)
    let memoData: Buffer
    let memoType: DataType
    if (parsedMemo.memoLength & 0x80000000) {
      debug('Memo data inline')
      memoData = relativeObjData.slice(parsedMemo.memoEnd)
      memoType = DataType.Text
    } else if (parsedMemo.memoLength & 0x40000000) {
      debug('LVAL type 1')
      const tmp = this.getOverflowRecord(parsedMemo.recordPointer)
      if (tmp === undefined) {
        throw new Error('LVAL type 1 memoData is undefined')
      }
      memoData = tmp
      memoType = DataType.Text
    } else {
      debug('LVAL type 2')

      const dataBlocks: Array<Buffer> = []
      let { recordPointer } = parsedMemo

      while (recordPointer) {
        const record = this.getOverflowRecord(recordPointer)
        if (record === undefined) {
          throw new Error('LVAL type 2 memoData is undefined')
        }

        dataBlocks.push(record.subarray(4))
        recordPointer = record.readInt32LE()
      }
      memoData = Buffer.concat(dataBlocks)
      memoType = DataType.Text
    }
    return parseType(memoType, memoData, memoData.length, this.version, this.textEncoding, this.sanitizeTextBuffer)
  }

  private parseDynamicLengthData(
    originalRecord: Buffer,
    relativeRecordMetadata: ReturnType<typeof parseRelativeObjectMetadataStruct>,
    relativeRecordsColumnMap: Dict<Column>
  ): void {
    const relativeOffsets = relativeRecordMetadata.variableLengthFieldOffsets
    let jumpTableAddition = 0
    let i = -1
    for (const columnIndex of Object.keys(relativeRecordsColumnMap)) {
      i += 1
      const column = relativeRecordsColumnMap[columnIndex]!
      const colName = column.colNameStr
      if (this.version === 3) {
        if (relativeRecordMetadata.variableLengthJumpTable.includes(i)) jumpTableAddition = (jumpTableAddition + 0x100) >>> 0
      }
      let relStart = relativeOffsets[i]
      let relEnd: number
      if (i + 1 === relativeOffsets.length) relEnd = relativeRecordMetadata.varLenCount
      else relEnd = relativeOffsets[i + 1]
      if (this.version > 3) {
        if (relEnd > originalRecord.length) relEnd = (relEnd & 0xff) >>> 0
        if (relStart > originalRecord.length) relStart = (relStart & 0xff) >>> 0
      }
      if (relStart === relEnd) {
        if (this.parsedTable[colName] === undefined) this.parsedTable[colName] = []
        this.parsedTable[colName]!.push('')
        continue
      }
      const relativeObjData = originalRecord.slice(relStart + jumpTableAddition, relEnd + jumpTableAddition)
      let parsedType: PossibleTypes

      if (column.type === DataType.Memo) {
        try {
          parsedType = this.parseMemo(relativeObjData)
        } catch {
          debug(`Failed to parse memo field. Using data as bytes`)
          parsedType = relativeObjData.toString()
        }
      } else {
        parsedType = parseType(
          column.type,
          relativeObjData,
          relativeObjData.length,
          this.version,
          this.textEncoding,
          this.sanitizeTextBuffer
        )
      }
      if (this.parsedTable[colName] === undefined) this.parsedTable[colName] = []
      this.parsedTable[colName]!.push(parsedType)
    }
  }

  private parseRow(record: Buffer): void {
    const originalRecord = Buffer.allocUnsafe(record.length)
    record.copy(originalRecord)
    let reverseRecord = Buffer.allocUnsafe(record.length)
    record.copy(reverseRecord)
    reverseRecord = reverseRecord.reverse()
    const nullTableLen = Math.floor((this.tableHeader.columnCount + 7) / 8)
    const nullTable: Array<boolean> = []
    if (nullTableLen && nullTableLen < originalRecord.length) {
      const nullTableBuffer = record.slice(nullTableLen === 0 ? 0 : record.length - nullTableLen)
      debug(record.slice(record.length - nullTableLen))
      for (let i = 0; i < nullTableBuffer.length; i++) {
        const byte = nullTableBuffer[i]
        for (let j = 0; j < 8; j++) {
          if ((byte & (1 << j)) === 0) nullTable.push(false)
          else nullTable.push(true)
        }
      }
    } else {
      debug(`Failed to parse null table column count ${this.tableHeader.columnCount}`)
      return
    }
    if (this.version > 3) record = record.slice(2)
    else record = record.slice(1)
    const relativeRecordsColumnMap: Dict<Column> = {}
    for (const i of Object.keys(this.columns)) {
      const column = this.columns[i]!

      if (!column.columnFlags.fixedLength) {
        relativeRecordsColumnMap[i] = column
        continue
      }
      this.parseFixedLengthData(record, column, nullTable)
    }
    if (relativeRecordsColumnMap) {
      const metadata = this.parseDynamicLengthRecordsMetadata(reverseRecord, originalRecord, nullTableLen)
      if (metadata === undefined) return
      this.parseDynamicLengthData(originalRecord, metadata, relativeRecordsColumnMap)
    }
  }

  public parse() {
    if (!this.table.linkedPages) return this.createEmptyTable()
    for (const dataChunk of this.table.linkedPages) {
      const originalData = dataChunk
      const parsedData = parseDataPageHeader(originalData, this.version)
      let lastOffset: number | undefined
      for (const recOffset of parsedData.recordOffsets) {
        if ((recOffset & 0x8000) >>> 0) {
          lastOffset = (recOffset & 0xfff) >>> 0
          continue
        }
        if ((recOffset & 0x4000) >>> 0) {
          const recPtrOffset = (recOffset & 0xfff) >>> 0
          lastOffset = recPtrOffset
          const overflowRecPtrBuffer = originalData.slice(recPtrOffset, recPtrOffset + 4)
          const overflowRecPtr = overflowRecPtrBuffer.readUInt32LE(0)
          const record = this.getOverflowRecord(overflowRecPtr)
          if (record !== undefined) this.parseRow(record)
          continue
        }
        let record: Buffer
        if (!lastOffset) record = originalData.slice(recOffset)
        else record = originalData.slice(recOffset, lastOffset)
        lastOffset = recOffset
        if (record) this.parseRow(record)
      }
    }
    return this.parsedTable
  }
}
