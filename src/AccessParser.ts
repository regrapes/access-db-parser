import { AccessTable } from './AccessTable'
import { TableObject } from './TableObject'
import { ACCESSHEADER, parseDataPageHeader } from './parsing-primitives'
import type { Dict } from './types'
import { ALL_VERSIONS } from './types'
import { categorizePages } from './utils'

const PAGE_SIZE_V3 = 0x800
const PAGE_SIZE_V4 = 0x1000

// Versions
const VERSION_3 = 0x00
const VERSION_4 = 0x01
const VERSION_5 = 0x02
const VERSION_2010 = 0x03

const NEW_VERSIONS = [VERSION_4, VERSION_5, VERSION_2010]

const SYSTEM_TABLE_FLAGS = [-0x80000000, -0x00000002, 0x80000000, 0x00000002]

export class AccessParser {
  private tableDefs: Dict<Buffer>
  private dataPages: Dict<Buffer>
  // private allPages: Dict<Buffer>;
  private tablesWithData: Dict<TableObject>
  private version = ALL_VERSIONS.VERSION_3
  private pageSize = PAGE_SIZE_V3
  private catalog: Dict<number>
  public constructor(
    private dbData: Buffer,
    private textEncoding: BufferEncoding = 'utf8',
    private sanitizeTextBuffer?: (buffer: Buffer) => Buffer
  ) {
    this.parseFileHeader()
    ;[this.tableDefs, this.dataPages /* this.allPages */] = categorizePages(this.dbData, this.pageSize)
    this.tablesWithData = this.linkTablesToData()
    this.catalog = this.parseCatalog()
  }

  private parseFileHeader(): void {
    let head: ReturnType<typeof ACCESSHEADER.parse>
    try {
      head = ACCESSHEADER.parse(this.dbData)
    } catch {
      throw new Error('Failed to parse DB file header. Check it is a valid file header')
    }
    const version = head.jetVersion
    if (NEW_VERSIONS.includes(version)) {
      if (version === VERSION_4) this.version = ALL_VERSIONS.VERSION_4
      else if (version === VERSION_5) this.version = ALL_VERSIONS.VERSION_5
      else if (version === VERSION_2010) this.version = ALL_VERSIONS.VERSION_2010
      this.pageSize = PAGE_SIZE_V4
    } else if (version !== VERSION_3) {
      throw new Error(`Unknown database version ${version} Trying to parse database as version 3`)
    }
  }

  private linkTablesToData(): Dict<TableObject> {
    const tablesWithData: Dict<TableObject> = {}
    for (const i of Object.keys(this.dataPages)) {
      const data = this.dataPages[i]!
      let parsedDP: ReturnType<typeof parseDataPageHeader>
      try {
        parsedDP = parseDataPageHeader(data, this.version)
      } catch {
        console.error(`Failed to parse data page ${data}`)
        continue
      }
      const pageOffset = parsedDP.owner * this.pageSize
      if (
        Object.keys(this.tableDefs)
          .map(str => parseInt(str, 10))
          .includes(pageOffset)
      ) {
        const tablePageValue = this.tableDefs[pageOffset]!
        if (!Object.keys(tablesWithData).includes(pageOffset.toString()))
          tablesWithData[pageOffset] = new TableObject(pageOffset, tablePageValue)
        tablesWithData[pageOffset]!.linkedPages.push(data)
      }
    }
    return tablesWithData
  }

  private parseCatalog() {
    const catalogPage = this.tablesWithData[2 * this.pageSize]!
    const accessTable = new AccessTable(
      catalogPage,
      this.version,
      this.pageSize,
      this.dataPages,
      this.tableDefs,
      this.textEncoding,
      this.sanitizeTextBuffer
    )
    const catalog = accessTable.parse()
    const tablesMapping: Dict<number> = {}
    let i = -1
    const names: Array<string> = catalog.Name as any
    const types: Array<number> = catalog.Type as any
    const flags: Array<number> = catalog.Flags as any
    const ids: Array<number> = catalog.Id as any
    if (names === undefined || types === undefined || flags === undefined || ids === undefined)
      throw new Error('The catalog is missing required fields')
    for (const tableName of names) {
      if (typeof tableName !== 'string') continue
      i += 1
      const tableType = 1
      if (types[i] === tableType) {
        if (!SYSTEM_TABLE_FLAGS.includes(flags[i]) && flags[i] === 0) {
          // TODO: CHECK IF 0 IS THE RIGHT FLAG TO SET
          // console.log(tableName);
          // console.log(flags[i]);
          tablesMapping[tableName] = ids[i]
        }
      }
    }
    return tablesMapping
  }

  private parseTableUnformatted(tableName: string) {
    let tableOffset = this.catalog[tableName]
    if (tableOffset === undefined) throw new Error(`Could not find table ${tableName} in Database`)
    tableOffset *= this.pageSize
    const table = this.tablesWithData[tableOffset]
    if (table === undefined) {
      const tableDef = this.tableDefs[tableOffset]
      if (tableDef === undefined) {
        throw new Error(`Could not find table ${tableName} offset ${tableOffset}`)
      } else {
        throw new Error('Empty table')
        // table = new TableObject(tableOffset, tableDef);
      }
    }
    const accessTable = new AccessTable(
      table,
      this.version,
      this.pageSize,
      this.dataPages,
      this.tableDefs,
      this.textEncoding,
      this.sanitizeTextBuffer
    )
    return accessTable.parse()
  }

  public parseTable(name: string) {
    const table = this.parseTableUnformatted(name)
    const fields = Object.keys(table)
    if (fields.length === 0) {
      return []
    }
    const linesNumber = table[fields[0]]!.length
    const lines: Array<Record<string, any>> = []
    for (let i = 0; i < linesNumber; ++i) {
      const line: any = {}
      for (const field of fields) {
        line[field] = table[field]![i]
      }
      lines.push(line)
    }
    return lines
  }

  public getTables() {
    return Object.keys(this.catalog)
  }

  public getVersion(): number {
    return this.version
  }
}
