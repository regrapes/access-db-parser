import { TextDecoder } from 'util'

import UUID from 'uuid'

import type { Version, Dict } from './types'

export enum DataType {
  Boolean = 1,
  Int8 = 2,
  Int16 = 3,
  Int32 = 4,
  Money = 5,
  Float32 = 6,
  Float64 = 7,
  DateTime = 8,
  Binary = 9,
  Text = 10,
  OLE = 11,
  Memo = 12,
  GUID = 15,
  Bit96Bytes17 = 16,
  Complex = 18,
}

const TABLE_PAGE_MAGIC = Buffer.from([0x02, 0x01])
const DATA_PAGE_MAGIC = Buffer.from([0x01, 0x01])
const BOMS = [Buffer.from([0xfe, 0xff]), Buffer.from([0xff, 0xfe])]

export const parseType = (
  dataType: DataType,
  buffer: Buffer,
  length?: number,
  version: Version = 3,
  textEncoding: BufferEncoding = 'utf8',
  sanitizeTextBuffer = (buffer: Buffer) => buffer
) => {
  switch (dataType) {
    case DataType.Int8: {
      return buffer.readInt8(0)
    }
    case DataType.Int16: {
      return buffer.readInt16LE(0)
    }
    case DataType.Int32:
    case DataType.Complex: {
      return buffer.readInt32LE(0)
    }
    case DataType.Float32: {
      return buffer.readFloatLE(0)
    }
    case DataType.Float64: {
      return buffer.readDoubleLE(0)
    }
    case DataType.Money: {
      return buffer.readUInt32LE(0) + buffer.readUInt32LE(4) * 0x10 ** 8
    }
    case DataType.DateTime: {
      const daysPassed = Math.floor(buffer.readDoubleLE(0))
      // ms access expresses hours in decimals
      const hoursPassedDecimal = buffer.readDoubleLE(0) % 1
      const hours = Math.floor(hoursPassedDecimal * 24)
      const minutes = Math.floor(((hoursPassedDecimal * 24) % 1) * 60)
      const seconds = Math.ceil(((((hoursPassedDecimal * 24) % 1) * 60) % 1) * 60)
      const date = new Date('1899/12/30')
      date.setUTCHours(12, 0, 0, 0)
      date.setUTCDate(date.getDate() + daysPassed)
      date.setUTCHours(hours, minutes, seconds)
      // todo check TIME ZONE
      return date
    }
    case DataType.Binary: {
      return buffer.slice(0, length).toString(textEncoding) // Maybe
    }
    case DataType.GUID: {
      return UUID.stringify(buffer.slice(0, 16))
    }
    case DataType.Bit96Bytes17: {
      return buffer.slice(0, 17).toString(textEncoding) // Maybe
    }
    case DataType.Text: {
      if (version > 3) {
        const sanitzedBuffer = sanitizeTextBuffer(buffer)
        if (sanitzedBuffer.slice(0, 2).compare(BOMS[0]) === 0 || sanitzedBuffer.slice(0, 2).compare(BOMS[1]) === 0) {
          return new TextDecoder(textEncoding, { ignoreBOM: true }).decode(sanitzedBuffer.slice(2))
        }

        return new TextDecoder('utf-16le').decode(buffer)
      }
      return buffer.toString(textEncoding)
    }

    default: {
      return null
    }
  }
}

export const categorizePages = (dbData: Buffer, pageSize: number): [Dict<Buffer>, Dict<Buffer>, Dict<Buffer>] => {
  if (dbData.length % pageSize)
    throw new Error(`DB is not full or pageSize is wrong. pageSize: ${pageSize} dbData.length: ${dbData.length}`)
  const pages: Dict<Buffer> = {}
  for (let i = 0; i < dbData.length; i += pageSize) pages[i] = dbData.slice(i, i + pageSize)
  const dataPages: Dict<Buffer> = {}
  const tableDefs: Dict<Buffer> = {}
  for (const page of Object.keys(pages)) {
    const comp1 = Buffer.compare(DATA_PAGE_MAGIC, pages[page]!.slice(0, DATA_PAGE_MAGIC.length)) === 0
    const comp2 = Buffer.compare(TABLE_PAGE_MAGIC, pages[page]!.slice(0, TABLE_PAGE_MAGIC.length)) === 0
    if (comp1) dataPages[page] = pages[page]
    else if (comp2) tableDefs[page] = pages[page]
  }
  return [tableDefs, dataPages, pages]
}
