// userApi/index.js
const cloud = require('wx-server-sdk')
const userService = require('./service')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 【新增】校验调用者是否为管理员（user 集合 isAdmin === true）
// 用于保护 setAdmin / deleteUser / searchUsers 等敏感操作，防止越权
async function ensureAdmin() {
  const { OPENID } = cloud.getWXContext()
  const db = cloud.database()
  try {
    const res = await db.collection('user').where({ _openid: OPENID }).get()
    return !!(res.data[0] && res.data[0].isAdmin)
  } catch (e) {
    console.error('校验管理员权限异常', e)
    return false
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const _openid = wxContext.OPENID // 微信给的标识
  const {
    action,
    params
  } = event
  try {
    let res
    switch (action) {
      // 根据uid查询单个用户完整信息
      case 'getByUid':
        res = await userService.getByUid(params.uid)
        return {
          code: 0, data: res, msg: 'success'
        }
      // 批量查询多个用户
      case 'getBatchUids':
        res = await userService.getBatchUids(params.uidList)
        return {
          code: 0, data: res, msg: 'success'
        }
      // 查询全部指导老师候选（role=teacher）
      case 'getTeachers':
        res = await userService.getTeachers()
        return {
          code: 0, data: res, msg: 'success'
        }
      // 获取队友联系方式（同队校验后仅返回邮箱，手机号永不下发）
      case 'getContact':
        res = await userService.getContact(_openid, params.tid, params.targetUid, params.scope)
        return {
          code: 0, data: res, msg: 'success'
        }
      // 更新用户基础信息（用户名/头像）
      case 'updateBase':
        await userService.updateBase(params.uid, params.info)
        return {
          code: 0, msg: '更新成功'
        }
      // 设置管理员权限（仅管理员：授予/取消 isAdmin）
      case 'setAdmin':
        if (!(await ensureAdmin())) return { code: -403, msg: '无管理员权限' }
        await userService.setAdmin(params.uid, params.isAdmin)
        return {
          code: 0, msg: '权限修改成功'
        }
      // 搜索用户（仅管理员，供授权管理页使用；keyword 支持 uid 或用户名）
      case 'searchUsers':
        if (!(await ensureAdmin())) return { code: -403, msg: '无管理员权限' }
        res = await userService.searchUsers(params.keyword)
        return {
          code: 0, data: res, msg: 'success'
        }
      // 分页查询用户（仅管理员，管理端列表）：params { page, pageSize, keyword, role }
      case 'getPage':
        if (!(await ensureAdmin())) return { code: -403, msg: '无管理员权限' }
        res = await userService.getPage(params || {})
        return {
          code: 0, data: res, msg: 'success'
        }
      // 设置匹配状态
      case 'setMatch':
        await userService.setMatch(params.uid, params.isMatch)
        return {
          code: 0, msg: '匹配状态修改成功'
        }
      // 用户加入队伍（新增tid）
      case 'addTid':
        await userService.addTid(params.uid, params.tid)
        return {
          code: 0, msg: '加入队伍成功'
        }
      // 用户退出队伍（移除tid）
      case 'removeTid':
        await userService.removeTid(params.uid, params.tid)
        return {
          code: 0, msg: '退出队伍成功'
        }
      // 批量替换队伍列表
      case 'setTidList':
        await userService.setTidList(params.uid, params.tidList)
        return {
          code: 0, msg: '队伍列表更新成功'
        }
      // 批量覆盖更新用户技能列表
      case 'setSkillList':
        await userService.setSkillList(params.uid, params.skillList)
        return { 
          code: 0, msg: '技能更新成功' 
        }
      // 删除用户（仅管理员）
      case 'deleteUser':
        if (!(await ensureAdmin())) return { code: -403, msg: '无管理员权限' }
        await userService.deleteUser(params.uid)
        return {
          code: 0, msg: '用户已删除'
        }
      // 微信静默登录
      case 'wxLogin':
        if (!_openid) return {
          code: -1,
          msg: '获取微信身份失败'
        }

        let user = await userService.getByOpenId(_openid)
        let isNew = false
        if (!user) {
          // 第一次来，创建一个待完善用户
          user = await userService.createWechatUser(_openid)
          isNew = true
        } else if (user.userInfo.uid === -1) {
          // 之前创过临时用户，但没绑定学号
          isNew = true
        }

        // 存量数据修复：老用户头像还是本地路径 → 统一修正为云存储默认头像
        if (user && user.userInfo && user.userInfo.avatar === '/subPackages/images/user/user.jpg') {
          user = await userService.fixLegacyDefaultAvatar(user)
        }

        return {
          code: 0,
            data: {
              ...user,
              isNew
            },
            msg: isNew ? '请绑定学号/工号' : '登录成功'
        }
      case 'updateProfile':
        // 注意：这里不再传 uid 做参数，而是通过 openid 找到该用户更新
        const updatedUser = await userService.updateProfile(_openid, params)
        return {
          code: 0,
          data: updatedUser,
          msg: '信息完善成功'
        }
      // 修改技能等级
      case 'updateSkillRating':
        await userService.updateSkillRating(params.uid, params.sid, params.level)
        return {
          code: 0, msg: '技能等级修改成功'
        }
      // 批量覆盖技能等级（保存前端/AI 评级结果）
      case 'setSkillRatingMap':
        res = await userService.setSkillRatingMap(params.uid, params.skill_rating)
        return {
          code: 0, data: res, msg: '技能评级保存成功'
        }
      // AI 技能评级（草稿：需先 npm install axios 并重新部署）
      case 'aiRateSkills':
        res = await userService.aiRateSkills(params.uid, params.skills, params.introduction)
        return {
          code: 0, data: res, msg: 'AI 评级完成'
        }
      default:
        return {
          code: -99, msg: '未知action操作'
        }
    }
  } catch (err) {
    console.error('userApi error:', err)
    return {
      code: -500,
      msg: '服务器异常',
      error: err.message
    }
  }
}