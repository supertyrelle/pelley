import { useTaskManager } from '~~/server/services/task-manager'
import type { CreateTaskOptions } from '~~/shared/types/task'

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateTaskOptions>(event)

  if (!body?.title || typeof body.title !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }
  if (!body?.agentId || typeof body.agentId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'agentId is required' })
  }
  if (!body?.projectPath || typeof body.projectPath !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'projectPath is required' })
  }

  const manager = useTaskManager()
  const task = await manager.createTask({
    title: body.title,
    agentId: body.agentId,
    projectPath: body.projectPath,
    useWorktree: body.useWorktree,
    contextScope: body.contextScope,
  })

  setResponseStatus(event, 201)
  return task
})
