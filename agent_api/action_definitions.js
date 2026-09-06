// AI Table Studio v2.6.8 / Table Action API Phase 4.7
// Single source of truth for action metadata, parameter schemas, CLI help and
// the generated HTTP JSON Schema artifact.

export const TABLE_ACTION_API_VERSION = '0.1';
export const TABLE_ACTION_API_PHASE = 'phase4.7';
export const TABLE_ACTION_APP_VERSION = '2.6.8';
export const ACTION_DEFINITION_VERSION = '1.2';

const id = { type: 'string', minLength: 1 };
const text = { type: 'string' };
const nonEmptyText = { type: 'string', minLength: 1 };
const bool = { type: 'boolean' };
const nonNegativeInteger = { type: 'integer', minimum: 0 };
const positiveInteger = { type: 'integer', minimum: 1 };
const number = { type: 'number' };
const ids = (maxItems = 500) => ({ type: 'array', items: id, minItems: 1, maxItems, uniqueItems: true });
const object = (properties = {}, required = [], extra = {}) => ({
  type: 'object',
  ...(required.length ? { required } : {}),
  properties,
  additionalProperties: false,
  ...extra
});
const array = (items, minItems = 0, maxItems) => ({
  type: 'array', items, minItems,
  ...(maxItems === undefined ? {} : { maxItems })
});
const empty = object();

const cell = object({ rowId: id, fieldId: id }, ['rowId', 'fieldId']);
const mediaLocatorProperties = { tableId: id, rowId: id, fieldId: id, index: nonNegativeInteger };
const mediaLocatorRequired = ['tableId', 'rowId', 'fieldId'];
const mediaSource = object({ rowId: id, fieldId: id, index: nonNegativeInteger }, ['rowId', 'fieldId']);
const mediaTarget = object({ rowId: id, fieldId: id, index: nonNegativeInteger }, ['rowId', 'fieldId']);
const rowPosition = {
  beforeRowId: id,
  afterRowId: id,
  toIndex: nonNegativeInteger
};
const range = object({ rowIds: ids(2000), fieldIds: ids(2000) }, ['rowIds', 'fieldIds']);
const sort = object({ fieldId: id, direction: { type: 'string', enum: ['asc', 'desc'] } }, ['fieldId', 'direction']);
const condition = object({
  fieldId: id,
  operator: { type: 'string', enum: ['equals', 'not_equals', 'contains', 'not_contains', 'empty', 'not_empty', 'in', 'gt', 'gte', 'lt', 'lte'] },
  value: {}
}, ['fieldId', 'operator']);
const filter = object({
  logic: { type: 'string', enum: ['and', 'or'] },
  conditions: array(condition, 0, 50)
}, ['logic', 'conditions']);
const option = object({ id, name: nonEmptyText, color: text }, ['name']);
const transactionStep = object({ action: nonEmptyText, params: { type: 'object' } }, ['action', 'params']);

const confirmation = {
  never: 'never',
  always: 'always',
  conditional: 'conditional'
};

function define({ permission, write = false, runtime = false, alwaysConfirm = false, confirm, summary, description, paramsSchema, notes = [] }) {
  return {
    permission,
    write,
    ...(runtime ? { runtime: true } : {}),
    ...(alwaysConfirm ? { alwaysConfirm: true } : {}),
    confirmation: confirm || (alwaysConfirm ? confirmation.always : confirmation.never),
    summary,
    description: description || summary,
    paramsSchema,
    notes
  };
}

const read = (summary, paramsSchema, extra = {}) => define({ permission: 'read', summary, paramsSchema, ...extra });
const writeData = (summary, paramsSchema, extra = {}) => define({ permission: 'write:data', write: true, summary, paramsSchema, ...extra });
const writeSchema = (summary, paramsSchema, extra = {}) => define({ permission: 'write:schema', write: true, alwaysConfirm: true, summary, paramsSchema, ...extra });
const writeMedia = (summary, paramsSchema, extra = {}) => define({ permission: 'write:media', write: true, summary, paramsSchema, ...extra });
const destructive = (summary, paramsSchema, extra = {}) => define({ permission: 'destructive', write: true, alwaysConfirm: true, summary, paramsSchema, ...extra });

export const ACTION_DEFINITIONS = {
  'system.get_capabilities': read('列出当前 API、Runtime 与 Provider 能力', object({ detail: { type: 'string', enum: ['summary', 'full'] } })),
  'system.describe_action': read('返回单个 Action 的精确参数 Schema、权限和示例', object({ action: nonEmptyText }, ['action'])),
  'context.get_current': read('读取当前工程、活动表格、Cell 与选择区上下文', empty),

  'table.list': read('列出全部子表及活动状态', empty),
  'table.get_schema': read('读取子表字段结构与记录统计', object({ tableId: id }, ['tableId'])),
  'table.create': writeSchema('创建子表', object({
    name: { type: 'string', minLength: 1, maxLength: 200 },
    tableId: id,
    description: { type: 'string', maxLength: 2000 },
    icon: { type: ['string', 'null'] },
    activate: bool
  }, ['name'])),
  'table.activate': writeData('激活目标子表并等待 Grid Runtime 挂载', object({ tableId: id }, ['tableId'])),
  'table.update': writeSchema('更新子表名称、说明或图标', object({
    tableId: id,
    patch: object({ name: nonEmptyText, description: { type: ['string', 'null'] }, icon: { type: ['string', 'null'] } }, [], { minProperties: 1 })
  }, ['tableId', 'patch'])),
  'table.duplicate': writeSchema('复制子表，可选择是否复制记录', object({ tableId: id, name: nonEmptyText, newTableId: id, copyRecords: bool }, ['tableId'])),
  'table.delete': destructive('删除子表及其中字段、记录和 Cell Link', object({ tableId: id }, ['tableId'])),
  'table.reorder': writeSchema('调整子表顺序', object({ tableId: id, toIndex: nonNegativeInteger }, ['tableId', 'toIndex'])),

  'view.get': read('读取 Grid 或 Gallery 视图配置', object({ tableId: id, viewMode: { type: 'string', enum: ['grid', 'gallery'] } })),
  'field.set_hidden': writeData('隐藏或显示指定列（不删除数据）', object({ tableId: id, fieldIds: ids(), hidden: bool }, ['tableId', 'fieldIds', 'hidden'])),
  'field.freeze_to': writeData('冻结至指定列；fieldId=null 取消连续冻结，保留单独冻结', object({ tableId: id, fieldId: { type: ['string', 'null'], minLength: 1 } }, ['tableId', 'fieldId'])),
  'field.set_individual_frozen': writeData('设置指定列的单独冻结状态，保留连续冻结', object({ tableId: id, fieldIds: ids(), frozen: bool }, ['tableId', 'fieldIds', 'frozen'])),
  'view.update': writeData('更新筛选、排序、分组、行高或画廊设置', object({
    tableId: id,
    viewMode: { type: 'string', enum: ['grid', 'gallery'] },
    patch: object({
      filter,
      filterEnabled: bool,
      sort: { anyOf: [sort, { type: 'null' }] },
      group: array(sort, 0, 20),
      groupEnabled: bool,
      foldedGroups: { type: 'array', items: text },
      rowHeight: { type: 'string', enum: ['short', 'medium', 'tall', 'extra'] },
      gallerySettings: { type: ['object', 'null'] }
    }, [], { minProperties: 1 }),
    activate: bool
  }, ['patch'])),

  'field.create': writeSchema('创建字段', object({ tableId: id, name: nonEmptyText, type: nonEmptyText, fieldId: id, config: { type: 'object' } }, ['tableId', 'name', 'type'])),
  'field.update': writeSchema('更新普通字段属性；AI 配置必须使用 field.configure_ai', object({
    tableId: id,
    fieldId: id,
    patch: object({
      name: nonEmptyText,
      width: { type: 'number', minimum: 60, maximum: 2000 },
      hidden: bool,
      color: text,
      prompt: text,
      refFields: { type: 'array', items: id, uniqueItems: true },
      type: nonEmptyText
    }, [], { minProperties: 1 })
  }, ['tableId', 'fieldId', 'patch'])),
  'field.reorder': writeSchema('调整字段列位置', object({ tableId: id, fieldId: id, beforeFieldId: id, afterFieldId: id, toIndex: nonNegativeInteger }, ['tableId', 'fieldId'], {
    oneOf: [
      { required: ['beforeFieldId'], not: { anyOf: [{ required: ['afterFieldId'] }, { required: ['toIndex'] }] } },
      { required: ['afterFieldId'], not: { anyOf: [{ required: ['beforeFieldId'] }, { required: ['toIndex'] }] } },
      { required: ['toIndex'], not: { anyOf: [{ required: ['beforeFieldId'] }, { required: ['afterFieldId'] }] } }
    ]
  })),
  'field.duplicate': writeSchema('复制字段配置，并可复制值与 Cell Link', object({
    tableId: id, fieldId: id, name: nonEmptyText, copyValues: bool, copyCellLinks: bool, beforeFieldId: id, afterFieldId: id
  }, ['tableId', 'fieldId'])),
  'field.options.get': read('读取单选或多选字段的选项', object({ tableId: id, fieldId: id }, ['tableId', 'fieldId'])),
  'field.options.upsert': writeSchema('新增或按 ID 更新选项', object({ tableId: id, fieldId: id, options: array(option, 1, 200) }, ['tableId', 'fieldId', 'options'])),
  'field.options.update': writeSchema('更新单个选项名称或颜色', object({ tableId: id, fieldId: id, optionId: id, name: nonEmptyText, color: text }, ['tableId', 'fieldId', 'optionId'], { minProperties: 4 })),
  'field.options.remove': writeSchema('删除选项，并可明确清理已引用值', object({ tableId: id, fieldId: id, optionId: id, clearValues: bool }, ['tableId', 'fieldId', 'optionId'])),
  'field.options.reorder': writeSchema('调整选项顺序', object({ tableId: id, fieldId: id, optionId: id, toIndex: nonNegativeInteger }, ['tableId', 'fieldId', 'optionId', 'toIndex'])),
  'field.configure_ai': writeSchema('安全配置 AI Text、AI Image 或 AI Video 字段', object({
    tableId: id,
    fieldId: id,
    config: object({
      prompt: text,
      refFields: { type: 'array', items: id, uniqueItems: true },
      model: text,
      sourceImage: text,
      sourceVideo: text,
      sourceAudio: text,
      skill: text,
      count: { type: 'integer', minimum: 1, maximum: 20 },
      size: text,
      folderPath: text,
      resolution: text,
      ratio: text,
      filenameTemplate: text,
      isRetouchMode: bool,
      saveToSourceFolder: bool,
      scaleToSource: bool,
      duration: text,
      sound: { type: ['boolean', 'string'] },
      mode: text,
      enhancePrompt: { type: ['boolean', 'string'] },
      offPeak: { type: ['boolean', 'string'] }
    }, [], { minProperties: 1 })
  }, ['tableId', 'fieldId', 'config'])),
  'field.delete': destructive('删除字段并清理记录值、引用与 Cell Link', object({ tableId: id, fieldId: id }, ['tableId', 'fieldId'])),
  'field.convert.preview': read('预览字段类型转换影响，不修改数据', object({ tableId: id, fieldId: id, targetType: nonEmptyText }, ['tableId', 'fieldId', 'targetType'])),
  'field.convert.run': writeSchema('执行字段类型转换', object({
    tableId: id,
    fieldId: id,
    targetType: nonEmptyText,
    invalidValuePolicy: { type: 'string', enum: ['reject', 'clear', 'keep'] },
    options: array(option, 0, 200)
  }, ['tableId', 'fieldId', 'targetType'])),

  'row.query': read('查询记录，支持字段投影、筛选、排序与当前视图', object({
    tableId: id,
    fields: { type: 'array', items: id, uniqueItems: true },
    filter,
    limit: { type: 'integer', minimum: 1, maximum: 500 },
    cursor: { type: ['string', 'null'] },
    rowIds: { type: 'array', items: id, uniqueItems: true, maxItems: 500 },
    scope: { type: 'string', enum: ['all', 'current_view'] },
    includeComputed: bool,
    sort
  }, ['tableId'])),
  'row.get': read('读取单条记录', object({ tableId: id, rowId: id }, ['tableId', 'rowId'])),
  'row.create': writeData('在表尾创建记录', object({
    tableId: id,
    rows: array(object({ id, values: { type: 'object' } }, ['values']), 1, 500)
  }, ['tableId', 'rows']), { confirm: confirmation.conditional }),
  'row.insert': writeData('在指定位置插入记录', object({
    tableId: id,
    rows: array(object({ id, values: { type: 'object' } }, ['values']), 1, 500),
    ...rowPosition
  }, ['tableId', 'rows'])),
  'row.duplicate': writeData('复制一组记录并插入指定位置', object({ tableId: id, rowIds: ids(), ...rowPosition }, ['tableId', 'rowIds'])),
  'row.delete': destructive('删除记录及其 Cell Link', object({ tableId: id, rowIds: ids() }, ['tableId', 'rowIds'])),
  'row.reorder': writeData('移动一组记录到指定序号', object({ tableId: id, rowIds: ids(), toIndex: nonNegativeInteger }, ['tableId', 'rowIds', 'toIndex']), { alwaysConfirm: true }),

  'cell.set': writeData('写入单个 Cell', object({ tableId: id, rowId: id, fieldId: id, value: {}, writeMode: { type: 'string', enum: ['replace', 'append', 'if_empty'] } }, ['tableId', 'rowId', 'fieldId', 'value']), { confirm: confirmation.conditional }),
  'cell.batch_set': writeData('批量写入 Cell', object({
    tableId: id,
    updates: array(object({ rowId: id, fieldId: id, value: {} }, ['rowId', 'fieldId', 'value']), 1, 2000),
    writeMode: { type: 'string', enum: ['replace', 'append', 'if_empty'] }
  }, ['tableId', 'updates']), { confirm: confirmation.conditional }),
  'cell.clear': writeData('清空一组 Cell', object({ tableId: id, cells: array(cell, 1, 2000) }, ['tableId', 'cells']), { alwaysConfirm: true }),
  'cell.copy_range': writeData('复制单元格或等尺寸范围', object({ tableId: id, source: range, target: range }, ['tableId', 'source', 'target']), { alwaysConfirm: true }),
  'cell.fill': writeData('向一列的一组记录填充同一值', object({ tableId: id, rowIds: ids(2000), fieldId: id, value: {} }, ['tableId', 'rowIds', 'fieldId', 'value']), { alwaysConfirm: true }),
  'cell.get_meta': read('读取 Cell Link 与当前值元信息', object({ tableId: id, rowId: id, fieldId: id }, ['tableId', 'rowId', 'fieldId'])),
  'cell.link': writeData('把多个 Cell 加入同一个联动组', object({ tableId: id, cells: array(cell, 2, 2000), groupId: id }, ['tableId', 'cells']), { alwaysConfirm: true }),
  'cell.unlink': writeData('解除一组 Cell 的联动关系', object({ tableId: id, cells: array(cell, 1, 2000) }, ['tableId', 'cells']), { alwaysConfirm: true }),

  'media.get': read('读取 Cell 中的持久媒体实例及 Crop/Trim', object({ ...mediaLocatorProperties }, mediaLocatorRequired)),
  'media.attach': writeMedia('附加新的本地媒体路径或 URL，不允许注入 Crop/Trim', object({
    tableId: id,
    rowId: id,
    fieldId: id,
    items: array(object({
      type: { type: 'string', enum: ['image', 'video', 'audio'] },
      path: nonEmptyText,
      url: nonEmptyText,
      name: text
    }, ['type'], { anyOf: [{ required: ['path'] }, { required: ['url'] }] }), 1, 100),
    mode: { type: 'string', enum: ['append', 'replace'] }
  }, ['tableId', 'rowId', 'fieldId', 'items']), { confirm: confirmation.conditional }),
  'media.copy_instance': writeMedia('复制已有媒体实例并完整保留 Crop/Trim', object({ tableId: id, source: mediaSource, target: mediaTarget, mode: { type: 'string', enum: ['append', 'replace'] } }, ['tableId', 'source', 'target']), { confirm: confirmation.conditional }),
  'media.list_by_row': read('按字段列出一行中的媒体实例', object({ tableId: id, rowId: id, fieldIds: { type: 'array', items: id, uniqueItems: true }, includeEmpty: bool }, ['tableId', 'rowId'])),
  'media.get_effective_context': read('解析智能字段实际提交模型的有序媒体上下文', object({ tableId: id, rowId: id, fieldId: id, temporaryReferenceFieldId: id }, ['tableId', 'rowId', 'fieldId'])),
  'media.remove': writeMedia('从 Cell 删除一个媒体实例；不会删除硬盘文件', object({ ...mediaLocatorProperties }, mediaLocatorRequired), { alwaysConfirm: true }),
  'media.move': writeMedia('在两个 Cell 之间移动媒体实例；不会移动硬盘文件', object({ tableId: id, source: mediaSource, target: mediaTarget }, ['tableId', 'source', 'target']), { alwaysConfirm: true, notes: ['此 Action 只移动表内媒体实例，不执行文件系统搬迁。'] }),
  'media.reorder': writeMedia('调整同一 Cell 内媒体实例顺序', object({ ...mediaLocatorProperties, toIndex: nonNegativeInteger }, [...mediaLocatorRequired, 'toIndex']), { alwaysConfirm: true }),
  'media.set_crop': writeMedia('设置图片媒体实例的比例裁剪矩形', object({
    ...mediaLocatorProperties,
    crop: object({ x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 }, width: { type: 'number', exclusiveMinimum: 0, maximum: 1 }, height: { type: 'number', exclusiveMinimum: 0, maximum: 1 }, unit: { const: 'ratio' } }, ['x', 'y', 'width', 'height', 'unit'])
  }, [...mediaLocatorRequired, 'crop']), { alwaysConfirm: true }),
  'media.clear_crop': writeMedia('清除图片媒体实例裁剪', object({ ...mediaLocatorProperties }, mediaLocatorRequired), { alwaysConfirm: true }),
  'media.set_trim': writeMedia('设置视频或音频媒体实例的 A-B 时间范围', object({ ...mediaLocatorProperties, startMs: { type: 'number', minimum: 0 }, endMs: { type: 'number', exclusiveMinimum: 0 }, durationMs: { type: 'number', exclusiveMinimum: 0 } }, [...mediaLocatorRequired, 'startMs', 'endMs']), { alwaysConfirm: true }),
  'media.clear_trim': writeMedia('清除视频或音频媒体实例的 A-B 时间范围', object({ ...mediaLocatorProperties }, mediaLocatorRequired), { alwaysConfirm: true }),
  'media.set_rating': writeMedia('设置媒体实例 0–5 星评分', object({ ...mediaLocatorProperties, rating: { type: 'number', minimum: 0, maximum: 5 } }, [...mediaLocatorRequired, 'rating']), { alwaysConfirm: true }),

  'generation.get_capabilities': read('列出当前已配置的生成 Provider、Model 与 ComfyUI Workflow', empty, { runtime: true }),
  'generation.preview': read('解析最终 Prompt、媒体、模型、参数与输出路径，不产生费用', object({ tableId: id, fieldId: id, rowIds: ids(), mode: { type: 'string', enum: ['missing_only', 'force'] } }, ['tableId', 'fieldId', 'rowIds']), { runtime: true }),
  'generation.run': define({
    permission: 'execute:generation', write: true, runtime: true, alwaysConfirm: true,
    summary: '提交 AI Text、AI Image 或 AI Video 生成任务',
    paramsSchema: object({ tableId: id, fieldId: id, rowIds: ids(), mode: { type: 'string', enum: ['missing_only', 'force'] }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 } }, ['tableId', 'fieldId', 'rowIds', 'idempotencyKey'])
  }),

  'job.list': read('查询生成任务', object({
    tableId: id,
    batchId: id,
    status: { type: 'array', items: nonEmptyText, uniqueItems: true },
    detail: { type: 'string', enum: ['summary', 'full'] },
    fields: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['jobId', 'localJobId', 'batchId', 'idempotencyKey', 'tableId', 'rowId', 'fieldId', 'mediaType', 'provider', 'model', 'phase', 'status', 'taskId', 'resultUrl', 'localPath', 'lastError', 'createdAt', 'updatedAt', 'generationIndex', 'remoteSubmitted', 'retryable'] } },
    limit: { type: 'integer', minimum: 1, maximum: 500 }
  }), { runtime: true }),
  'job.get': read('读取单个生成任务', object({ jobId: id }, ['jobId']), { runtime: true }),
  'job.retry': define({ permission: 'execute:generation', write: true, runtime: true, alwaysConfirm: true, summary: '仅恢复已有 taskId 或 resultUrl 的任务', paramsSchema: object({ jobId: id }, ['jobId']) }),
  'job.cancel': define({ permission: 'execute:generation', write: true, runtime: true, alwaysConfirm: true, summary: '本地取消生成任务', paramsSchema: object({ jobId: id }, ['jobId']) }),
  'job.get_result': read('读取任务结果与本地文件状态', object({ jobId: id }, ['jobId']), { runtime: true }),
  'job.bind_result': writeMedia('把已有任务结果绑定到目标 Cell', object({ jobId: id, target: object({ tableId: id, rowId: id, fieldId: id, mode: { type: 'string', enum: ['append', 'replace'] } }, ['tableId', 'rowId', 'fieldId']) }, ['jobId', 'target']), { runtime: true, alwaysConfirm: true }),
  'job.delete_history': destructive('删除 Job Center 历史记录；不删除结果文件', object({ jobId: id }, ['jobId']), { runtime: true }),
  'job.cleanup_stale.preview': read('核验并预览真正失联的 ComfyUI Job，不修改 Job 或 Cell', object({
    tableId: id,
    jobIds: { type: 'array', items: id, uniqueItems: true, minItems: 1, maxItems: 500 },
    staleAfterMinutes: { type: 'integer', minimum: 5, maximum: 10080 },
    includeProtected: bool,
    limit: { type: 'integer', minimum: 1, maximum: 500 }
  }, ['tableId']), { runtime: true, notes: ['终态、已有结果、未超过阈值、远端仍在队列/History、远端不可达的 Job 都会被保护。'] }),
  'job.cleanup_stale': destructive('清理经远端核验已经失联的 Job，并移除对应 Cell 占位', object({
    tableId: id,
    jobIds: { type: 'array', items: id, uniqueItems: true, minItems: 1, maxItems: 500 },
    staleAfterMinutes: { type: 'integer', minimum: 5, maximum: 10080 },
    includeProtected: bool,
    limit: { type: 'integer', minimum: 1, maximum: 500 }
  }, ['tableId']), { runtime: true, notes: ['必须先使用 job.cleanup_stale.preview。每个 Job 会在执行瞬间重新核验。', '只清理超过阈值且 taskId 同时不在 ComfyUI Queue 与 History 的非终态 Job。', '不会处理成功、失败、取消、已有结果、真实运行/排队或远端状态未知的 Job。', '删除 Job 历史但不删除任何结果文件；Cell 中仅移除匹配 jobId 的 networkJob 占位。'] }),

  'workspace.get_dirty_state': read('读取 Workspace Revision、保存状态与文件绑定状态', empty, { runtime: true }),
  'workspace.save': define({ permission: 'workspace:save', write: true, runtime: true, alwaysConfirm: true, summary: '保存当前已绑定且已授权的工程文件', paramsSchema: empty }),
  'transaction.preview': read('预览原子数据事务的每一步和汇总 Effects', object({ actions: array(transactionStep, 1, 500) }, ['actions'])),
  'transaction.execute': writeData('原子执行一组纯数据 Mutation', object({ actions: array(transactionStep, 1, 500) }, ['actions']), { alwaysConfirm: true }),
  'undo.get_status': read('读取 API Undo/Redo 状态', empty, { runtime: true }),
  'undo.apply': writeData('执行 API Undo Token', object({ undoToken: id }, ['undoToken']), { runtime: true, alwaysConfirm: true }),
  'redo.apply': writeData('执行 API Redo Token', object({ undoToken: id }, ['undoToken']), { runtime: true, alwaysConfirm: true }),

  'batch.list': read('列出生成批次', object({ tableId: id, status: { type: 'array', items: nonEmptyText }, limit: { type: 'integer', minimum: 1, maximum: 500 } }), { runtime: true }),
  'batch.get': read('读取生成批次详情', object({ batchId: id }, ['batchId']), { runtime: true }),
  'batch.cancel': define({ permission: 'execute:generation', write: true, runtime: true, alwaysConfirm: true, summary: '取消批次中的可取消任务', paramsSchema: object({ batchId: id }, ['batchId']) }),
  'batch.retry_failed': define({ permission: 'execute:generation', write: true, runtime: true, alwaysConfirm: true, summary: '恢复批次中可安全重试的失败任务', paramsSchema: object({ batchId: id }, ['batchId']) }),
  'batch.list_results': read('列出批次结果', object({ batchId: id, limit: { type: 'integer', minimum: 1, maximum: 500 } }, ['batchId']), { runtime: true }),

  'export.preview': read('预览表格或附件导出计划，不写文件', object({ tableId: id, format: { type: 'string', enum: ['attachments', 'csv', 'json'] }, rowIds: { type: 'array', items: id, uniqueItems: true }, fieldIds: { type: 'array', items: id, uniqueItems: true } }), { runtime: true }),
  'export.attachments': define({ permission: 'filesystem:export', write: true, runtime: true, alwaysConfirm: true, summary: '复制附件到指定文件夹', paramsSchema: object({ tableId: id, folderPath: nonEmptyText, rowIds: { type: 'array', items: id, uniqueItems: true }, fieldIds: { type: 'array', items: id, uniqueItems: true }, collisionPolicy: { type: 'string', enum: ['rename', 'skip', 'overwrite', 'error'] } }, ['folderPath']) }),
  'export.csv': define({ permission: 'filesystem:export', write: true, runtime: true, alwaysConfirm: true, summary: '把表格导出为 CSV', paramsSchema: object({ tableId: id, folderPath: nonEmptyText, filename: nonEmptyText, rowIds: { type: 'array', items: id, uniqueItems: true }, fieldIds: { type: 'array', items: id, uniqueItems: true } }, ['folderPath']) }),
  'export.json': define({ permission: 'filesystem:export', write: true, runtime: true, alwaysConfirm: true, summary: '把表格导出为 JSON', paramsSchema: object({ tableId: id, folderPath: nonEmptyText, filename: nonEmptyText, rowIds: { type: 'array', items: id, uniqueItems: true }, fieldIds: { type: 'array', items: id, uniqueItems: true } }, ['folderPath']) })
};

export const IMPLEMENTED_ACTIONS = Object.freeze(Object.keys(ACTION_DEFINITIONS));
export const PLANNED_ACTIONS = Object.freeze([]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function getActionMetadata(action) {
  const definition = ACTION_DEFINITIONS[action];
  if (!definition) return null;
  const { permission, write, runtime, alwaysConfirm } = definition;
  return { permission, write, ...(runtime ? { runtime: true } : {}), ...(alwaysConfirm ? { alwaysConfirm: true } : {}) };
}

function placeholderFor(propertyName, schema) {
  if (schema?.const !== undefined) return schema.const;
  if (Array.isArray(schema?.enum) && schema.enum.length) return schema.enum[0];
  if (schema?.anyOf?.length) return placeholderFor(propertyName, schema.anyOf[0]);
  const type = Array.isArray(schema?.type) ? schema.type.find(item => item !== 'null') : schema?.type;
  if (type === 'boolean') return true;
  if (type === 'integer' || type === 'number') return schema.minimum ?? schema.exclusiveMinimum ?? 0;
  if (type === 'array') return [placeholderFor(propertyName.replace(/s$/, ''), schema.items || {})];
  if (type === 'object' || schema?.properties) {
    const result = {};
    for (const key of schema.required || []) result[key] = placeholderFor(key, schema.properties?.[key] || {});
    return result;
  }
  if (/folderPath/i.test(propertyName)) return 'F:/output';
  if (/filename/i.test(propertyName)) return 'export';
  if (/tableId/i.test(propertyName)) return 'table_xxx';
  if (/fieldId/i.test(propertyName)) return 'field_xxx';
  if (/rowId/i.test(propertyName)) return 'row_xxx';
  if (/jobId/i.test(propertyName)) return 'job_xxx';
  if (/batchId/i.test(propertyName)) return 'batch_xxx';
  if (/undoToken/i.test(propertyName)) return 'undo_xxx';
  if (/idempotencyKey/i.test(propertyName)) return 'unique-operation-001';
  if (/action/i.test(propertyName)) return 'table.list';
  if (/name/i.test(propertyName)) return 'Example';
  if (/type/i.test(propertyName)) return 'text';
  return 'value';
}

const EXAMPLE_PARAMS = {
  'system.get_capabilities': { detail: 'summary' },
  'system.describe_action': { action: 'field.configure_ai' },
  'field.configure_ai': { tableId: 'table_xxx', fieldId: 'field_ai_video', config: { folderPath: 'F:/output', duration: '{时长}', resolution: '{分辨率}', ratio: '{比例}' } },
  'cell.batch_set': { tableId: 'table_xxx', writeMode: 'replace', updates: [{ rowId: 'row_xxx', fieldId: 'field_xxx', value: 'Example' }] },
  'media.move': { tableId: 'table_xxx', source: { rowId: 'row_source', fieldId: 'field_media', index: 0 }, target: { rowId: 'row_target', fieldId: 'field_media' } },
  'generation.run': { tableId: 'table_xxx', fieldId: 'field_ai_xxx', rowIds: ['row_xxx'], mode: 'missing_only', idempotencyKey: 'generation-001' },
  'job.cleanup_stale.preview': { tableId: 'table_xxx', staleAfterMinutes: 30 },
  'job.cleanup_stale': { tableId: 'table_xxx', staleAfterMinutes: 30 }
};

export function describeAction(action) {
  const definition = ACTION_DEFINITIONS[action];
  if (!definition) return null;
  const params = clone(EXAMPLE_PARAMS[action] || placeholderFor('params', definition.paramsSchema));
  return {
    name: action,
    definitionVersion: ACTION_DEFINITION_VERSION,
    summary: definition.summary,
    description: definition.description,
    permission: definition.permission,
    write: definition.write,
    runtime: !!definition.runtime,
    confirmation: definition.confirmation,
    supportsDryRun: !!definition.write,
    supportsExpectedRevision: !!definition.write,
    supportsIdempotencyKey: !!definition.write,
    paramsSchema: clone(definition.paramsSchema),
    notes: clone(definition.notes || []),
    exampleRequest: {
      version: TABLE_ACTION_API_VERSION,
      action,
      ...(definition.alwaysConfirm ? { confirmed: true } : {}),
      params
    }
  };
}

export function buildActionRequestSchema() {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `https://hongs-ai-table.local/schema/table-action-api/${TABLE_ACTION_API_VERSION}`,
    title: `AI Table Studio ${TABLE_ACTION_APP_VERSION} Table Action API v${TABLE_ACTION_API_VERSION} ${TABLE_ACTION_API_PHASE}`,
    type: 'object',
    required: ['version', 'action', 'params'],
    properties: {
      version: { const: TABLE_ACTION_API_VERSION },
      requestId: { type: ['string', 'null'] },
      actor: object({ type: { type: 'string', enum: ['user', 'agent', 'system'] }, name: text }, ['type']),
      dryRun: { type: 'boolean', default: false },
      confirmed: { type: 'boolean', default: false },
      expectedRevision: { type: 'integer', minimum: 0 },
      idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
      action: { type: 'string', enum: [...IMPLEMENTED_ACTIONS] },
      params: { type: 'object' }
    },
    additionalProperties: false,
    allOf: IMPLEMENTED_ACTIONS.map(action => ({
      if: { properties: { action: { const: action } }, required: ['action'] },
      then: { properties: { params: clone(ACTION_DEFINITIONS[action].paramsSchema) } }
    })),
    'x-action-definition-version': ACTION_DEFINITION_VERSION,
    'x-app-version': TABLE_ACTION_APP_VERSION,
    'x-phase': TABLE_ACTION_API_PHASE
  };
}
