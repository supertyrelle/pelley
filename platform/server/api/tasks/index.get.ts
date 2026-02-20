import { useTaskManager } from '~~/server/services/task-manager'
import type { TaskStatus } from '~~/shared/types/task'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const manager = useTaskManager()
  await manager.init()

  return manager.listTasks({
    projectPath: query.projectPath as string | undefined,
    status: query.status as TaskStatus | undefined,
  })
})
