// cloudfunctions/skillApi/index.js
// 路由型云函数：用 { action, params } 统一管技能字典的 getAll / add / update / delete
// ----------------------------------------------------------------------------
// 【为何整合】原 skill_add / skill_getAll 是两个独立云函数：
//   - skill_add 无任何校验：任何登录用户都能直接 callFunction 灌任意技能
//     （无管理员校验、无空值校验、无重名校验 → 字典会被刷成垃圾数据，
//      而 sid 又是 user.skills / teams.team_needs 的引用键，污染后难以修复）
//   - 没有 update / delete，字典只能增不能改，管理员只能去控制台手工改库
// 现统一收敛到 skillApi，写操作一律 ensureAdmin + 参数校验，删除前做 4 处引用检查。
// ============================================================================
const cloud = require('wx-server-sdk')
// ⚠️ 必须先 init 再 require service：service.js 顶层就 new 出实例并在构造函数里
//    调 cloud.database()，若此时 SDK 未初始化，加载期即抛错 → 云函数进程直接退出
//    （表现为 -504002 functions execute fail / code exit unexpected）。
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const skillService = require('./service')

// ==================== 【安全】管理员校验（双通道，实现见 adminGuard.js） ====================
// ① 小程序端：OPENID（原逻辑）  ② Web 管理端：验签 event.adminToken
// 不能只依赖前端隐藏入口 —— 任何人都能直接 callFunction 伪造 action/params。
const { ensureAdmin } = require('./adminGuard')

/**
 * 云函数入口
 * @param {Object} event
 * @param {string} event.action getAll | add | update | delete
 * @param {Object} event.params
 *   getAll  —— 无
 *   add     —— { name, desc? }
 *   update  —— { sid, name?, desc? }
 *   delete  —— { sid }
 */
exports.main = async (event) => {
  const { action } = event || {}
  const params = (event && event.params) || {}
  try {
    switch (action) {
      // 查询全部技能（技能字典属公开数据，前端 store/skills.js 依赖它，不加权限）
      case 'getAll': {
        const list = await skillService.getAll()
        return { code: 0, data: list, msg: 'success' }
      }

      // 新增技能（管理员；名称非空且不得重名）
      case 'add': {
        if (!(await ensureAdmin(event))) {
          return { code: -403, msg: '无权限：仅管理员可新增技能' }
        }
        // 【空值校验】原 skill_add 直接拿 skillName 写库，空字符串/纯空格也会落库
        const name = String(params.name == null ? '' : params.name).trim()
        if (!name) {
          return { code: -1, msg: '技能名称不能为空' }
        }
        // 【去重校验】照搬前端 store/skills.js 的重名口径（name 精确相等）
        if (await skillService.nameExists(name)) {
          return { code: -1, msg: `技能「${name}」已存在，请勿重复添加` }
        }
        const sid = await skillService.add(name, params.desc)
        return { code: 0, data: { sid }, msg: '新增成功' }
      }

      // 修改技能（管理员；sid 必须存在；新名称非空且不得与他人重名）
      case 'update': {
        if (!(await ensureAdmin(event))) {
          return { code: -403, msg: '无权限：仅管理员可修改技能' }
        }
        const sidNum = Number(params.sid)
        if (!sidNum) {
          return { code: -1, msg: '缺少有效的 sid' }
        }
        const exists = await skillService.findBySid(sidNum)
        if (!exists) {
          return { code: -1, msg: '技能不存在' }
        }
        if (params.name !== undefined) {
          const name = String(params.name).trim()
          if (!name) {
            return { code: -1, msg: '技能名称不能为空' }
          }
          if (await skillService.nameExists(name, sidNum)) {
            return { code: -1, msg: `技能「${name}」已存在，请勿重复命名` }
          }
        }
        await skillService.update(sidNum, params)
        return { code: 0, msg: '修改成功' }
      }

      // 删除技能（管理员；先做 4 处引用检查，有引用一律拦截，绝不级联删除）
      case 'delete': {
        if (!(await ensureAdmin(event))) {
          return { code: -403, msg: '无权限：仅管理员可删除技能' }
        }
        const sidNum = Number(params.sid)
        if (!sidNum) {
          return { code: -1, msg: '缺少有效的 sid' }
        }
        const exists = await skillService.findBySid(sidNum)
        if (!exists) {
          return { code: -1, msg: '技能不存在' }
        }

        const refs = await skillService.checkRefs(sidNum)
        // 扫描被 MAX_SCAN 截断 = 引用情况无法确认，宁可不删也不可错删
        if (refs.truncated) {
          return {
            code: -1,
            msg: '数据量过大，无法完成引用检查，已取消删除',
            data: refs
          }
        }
        if (refs.userCount || refs.teamCount) {
          const parts = []
          if (refs.userCount) parts.push(`${refs.userCount} 位用户`)
          if (refs.teamCount) parts.push(`${refs.teamCount} 支队伍`)
          return {
            code: -1,
            msg: `已被 ${parts.join('、')} 使用，不能删除`,
            // 回传明细，方便管理员看清引用在哪（尤其 userRating > 0 的幽灵键）
            data: refs
          }
        }

        await skillService.remove(sidNum)
        return { code: 0, msg: '删除成功' }
      }

      default:
        return { code: -99, msg: '未知操作action' }
    }
  } catch (err) {
    console.error('skillApi error:', err)
    return { code: -500, msg: '服务器异常', error: err.message }
  }
}
