// store/skills.js
// const store = require('./index')

// 统一走路由型云函数 skillApi：{ action, params } → { code, data, msg }
const API_NAME = 'skillApi'

const skills = {
  // 缓存云端技能数组 [{sid:1,name:"Java"},...]
  state: [],

  // 从云函数拉取全部技能
  async loadSkills() {
    const res = await wx.cloud.callFunction({
      name: API_NAME,
      data: { action: 'getAll' }
    })
    // 取出云函数内部返回的对象
    const data = res.result || {}
    if (data.code === 0) {
      // 赋值云函数返回的列表
      this.state = data.data || []
    }
    // 把业务数据返回给劫持层，方便打印日志
    console.log(data.data);
    return data
  },

  // 获取全部技能数组
  getAll() {
    return this.state
  },

  // 根据技能名称查sid
  getIdByName(skillName) {
    const target = this.state.find(item => item.name === skillName)
    return target ? target.sid : null
  },

  // 根据sid查技能名称
  getNameById(sid) {
    const target = this.state.find(item => item.sid === sid)
    return target ? target.name : "未知技能"
  },

  // 新增技能（调用云函数，成功后刷新缓存）
  // 注意：skillApi 的 add 带管理员校验 + 空值/重名校验，非管理员会被 -403 拒绝
  async addSkill(skillName) {
    const res = await wx.cloud.callFunction({
      name: API_NAME,
      data: { action: 'add', params: { name: skillName } }
    })
    // 云函数返回体在 res.result 上（旧写法误用 res.success / res.newSid，恒为 undefined）
    const data = res.result || {}
    if (data.code === 0) {
      // 新增完成重新拉取最新列表
      await this.loadSkills()
      // 【修复】旧写法 return res.newSid 恒为 undefined，现从 result.data 取
      return (data.data && data.data.sid) || null
    }
    throw new Error(data.msg || "新增技能失败")
  }
}

module.exports = skills