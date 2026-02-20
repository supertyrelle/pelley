export interface DiffFile {
  path: string
  oldPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  rawDiff: string
}

export interface ChangedFile {
  path: string
  status: 'A' | 'M' | 'D' | 'R'
}
