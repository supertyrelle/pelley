export interface WorktreeInfo {
  path: string
  branchName: string
  headCommit: string
  isMain: boolean
  taskSlug?: string
  createdAt?: Date
}
