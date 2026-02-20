import { useTaskManager } from '~~/server/services/task-manager'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing task id' })
  }

  const manager = useTaskManager()
  await manager.init()

  const task = manager.getTask(id)
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: `Task not found: ${id}` })
  }

  return task
})
