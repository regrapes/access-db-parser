export class TableObject {
  public value: Buffer
  public linkedPages: Array<Buffer> = []
  public constructor(_offset: number, value: Buffer) {
    this.value = value
    this.linkedPages = []
  }
}
