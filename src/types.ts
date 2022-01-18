export type Version = 3 | 4 | 5 | 2010

export type Dict<T> = Record<number | string, T | undefined>

export type PossibleTypes = boolean | string | Date | null | number

export enum ALL_VERSIONS {
  VERSION_3 = 3,
  VERSION_4 = 4,
  VERSION_5 = 5,
  VERSION_2010 = 2010,
}
