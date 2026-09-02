// store/skills.js
// const store = require('./index')
const skills = {
  // 缓存云端技能数组 [{sid:1,name:"Java"},...]
  state: [],

  // 从云函数拉取全部技能
  async loadSkills() {
    const res = await wx.cloud.callFunction({
      name: 'skill_getAll'
    })
    // 取出云函数内部返回的对象
    const data = res.result
    if (data.success) {
      // 赋值云函数返回的list
      this.state = data.list
    }
    // 把业务数据返回给劫持层，方便打印日志
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
  async addSkill(skillName) {
    const res = await wx.cloud.callFunction({
      name: 'skill_add',
      data: { skillName }
    })
    if (res.success) {
      // 新增完成重新拉取最新列表
      await this.loadSkills()
      return res.newSid
    }
    throw new Error(res.msg || "新增技能失败")
  }
}

module.exports = skills