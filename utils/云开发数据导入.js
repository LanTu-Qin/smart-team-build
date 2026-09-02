// userApi/service.js
const cloud = require('wx-server-sdk')
const bcrypt = require('bcryptjs')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

class UserService {
  constructor() {
    this.collection = db.collection('users')
    // 加密盐 rounds
    this.saltRounds = 10
  }
  // 根据uid查询单个用户
  async getByUid(uid) {
    const res = await this.collection.where({ "userInfo.uid": uid }).get()
    return res.data[0] || null
  }
  // 根据用户名查询用户
  async getByUsername(username) {
    const res = await this.collection.where({ "userInfo.username": username }).get()
    return res.data[0] || null
  }
  // 批量根据uid数组查询
  async getBatchUids(uidList) {
    const res = await this.collection.where({
      "userInfo.uid": _.in(uidList)
    }).get()
    return res.data
  }

  // 哈希加密密码
  async hashPassword(rawPwd) {
    return await bcrypt.hash(rawPwd, this.saltRounds)
  }
  // 比对明文与哈希密码
  async comparePassword(rawPwd, hashPwd) {
    return await bcrypt.compare(rawPwd, hashPwd)
  }

  // 创建新用户（支持传入password自动加密）
  async createUser(userInfo) {
    const uid = Date.now()
    // 处理密码
    let passwordHash = ''
    if (userInfo.password) {
      passwordHash = await this.hashPassword(userInfo.password)
    }
    const userData = {
      userInfo: {
        uid,
        username: userInfo.username || '',
        avatar: userInfo.avatar || 'cloud://cloud1-d8gb9nir3847ec081.636c-cloud1-d8gb9nir3847ec081-1444113575/images/user/user.jpg'
      },
      tid_list: [],
      skills: [],
      isLogin: false,
      isAdmin: false,
      is_matching: false,
      password: passwordHash // 新增密码哈希字段
    }
    await this.collection.add({ data: userData })
    return uid
  }

  // ========== 新增密码校验相关方法 ==========
  // 用户名+密码登录校验
  async loginByUsername(username, password) {
    const user = await this.getByUsername(username)
    if (!user) return { valid: false, msg: '用户名不存在' }
    // 无密码场景
    if (!user.password) return { valid: false, msg: '该账号未设置密码' }
    const isMatch = await this.comparePassword(password, user.password)
    if (!isMatch) return { valid: false, msg: '密码错误' }
    return { valid: true, data: user }
  }

  // uid+密码登录校验
  async loginByUid(uid, password) {
    const user = await this.getByUid(uid)
    if (!user) return { valid: false, msg: '用户不存在' }
    if (!user.password) return { valid: false, msg: '该账号未设置密码' }
    const isMatch = await this.comparePassword(password, user.password)
    if (!isMatch) return { valid: false, msg: '密码错误' }
    return { valid: true, data: user }
  }

  // 修改密码（需校验旧密码）
  async updatePassword(uid, oldPwd, newPwd) {
    const user = await this.getByUid(uid)
    if (!user) return { ok: false, msg: '用户不存在' }
    // 校验旧密码
    const isOldMatch = await this.comparePassword(oldPwd, user.password)
    if (!isOldMatch) return { ok: false, msg: '原密码错误' }
    // 加密新密码更新
    const newHash = await this.hashPassword(newPwd)
    await this.collection.where({ "userInfo.uid": uid }).update({
      data: { password: newHash }
    })
    return { ok: true, msg: '密码修改成功' }
  }

  // 初始化/重置密码（管理员接口，无需旧密码）
  async resetPassword(uid, newPwd) {
    const newHash = await this.hashPassword(newPwd)
    await this.collection.where({ "userInfo.uid": uid }).update({
      data: { password: newHash }
    })
    return true
  }
  // ======================================

  // 更新用户名、头像基础信息
  async updateBase(uid, info) {
    await this.collection.where({ "userInfo.uid": uid }).update({
      data: {
        "userInfo.username": info.username,
        "userInfo.avatar": info.avatar
      }
    })
    return true
  }
  // 设置管理员
  async setAdmin(uid, isAdmin) {
    await this.collection.where({ "userInfo.uid": uid }).update({
      data: { isAdmin: !!isAdmin }
    })
    return true
  }
  // 设置匹配状态
  async setMatch(uid, isMatch) {
    await this.collection.where({ "userInfo.uid": uid }).update({
      data: { is_matching: !!isMatch }
    })
    return true
  }
  // 添加队伍tid（自动去重）
  async addTid(uid, tid) {
    const user = await this.getByUid(uid)
    if (!user) return false
    if (!user.tid_list.includes(tid)) {
      await this.collection.where({ "userInfo.uid": uid }).update({
        data: { tid_list: _.push(tid) }
      })
    }
    return true
  }
  // 移除单个队伍tid
  async removeTid(uid, tid) {
    await this.collection.where({ "userInfo.uid": uid }).update({
      data: { tid_list: _.pull(tid) }
    })
    return true
  }
  // 批量替换全部队伍
  async setTidList(uid, tidList) {
    await this.collection.where({ "userInfo.uid": uid }).update({
      data: { tid_list: tidList }
    })
    return true
  }
  // 添加技能sid（去重）
  async addSkill(uid, sid) {
    const user = await this.getByUid(uid)
    if (!user) return false
    if (!user.skills.includes(sid)) {
      await this.collection.where({ "userInfo.uid": uid }).update({
        data: { skills: _.push(sid) }
      })
    }
    return true
  }
  // 删除单个技能
  async removeSkill(uid, sid) {
    await this.collection.where({ "userInfo.uid": uid }).update({
      data: { skills: _.pull(sid) }
    })
    return true
  }
  // 清空全部技能
  async clearAllSkill(uid) {
    await this.collection.where({ "userInfo.uid": uid }).update({
      data: { skills: [] }
    })
    return true
  }
  // 删除用户
  async deleteUser(uid) {
    await this.collection.where({ "userInfo.uid": uid }).remove()
    return true
  }
}
module.exports = new UserService()