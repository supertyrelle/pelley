import { useTaskManager } from '~~/server/services/task-manager'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing task id' })
  }

  const manager = useTaskManager()
  await manager.closeTask(id)

  return { closed: true, id }
})
