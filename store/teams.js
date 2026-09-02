// store/teams.js
const store = require('./index')
const teams = {
  // 内存缓存：从云端拉取的队伍列表
  state: {
    list: []
  },

  /**
   * 拉取全部队伍存入本地缓存
   */
  async loadAllTeams() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: {
          action: 'getList',
          params: {}
        }
      })
      const cloudRes = res.result
      // console.log('[teams.loadAllTeams] 完整返回', cloudRes)
      if (cloudRes.code === 0) {
        this.state.list = cloudRes.data || []
        // console.log('[teams.loadAllTeams] 缓存成功，队伍数量：', this.state.list.length)
      } else {
        console.warn('[teams.loadAllTeams] 业务失败', cloudRes.msg)
      }
      return cloudRes
    } catch (err) {
      console.error('[teams.loadAllTeams] 调用异常', err)
      return { code: -1, data: [], msg: '网络/云函数异常' }
    }
  },

  // ========== 同步只读查询方法（仅读内存，不请求云函数） ==========
  getList() {
    return this.state.list
  },
  getByTid(tid) {
    return this.state.list.find(item => item.tid === tid) || null
  },
  getByCid(cid) {
    return this.state.list.filter(item => item.cid_list.includes(cid))
  },
  getByUid(uid) {
    return this.state.list.filter(item => Object.keys(item.members).includes(String(uid)))
  },

  // ========== 异步修改类方法（调用云函数，成功后重载列表） ==========
  /** 创建队伍 */
  async createTeam(teamInfo) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'create', params: { teamInfo } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[createTeam]', err)
      return { code: -1, msg: '创建队伍失败' }
    }
  },

  /** 添加队员 */
  async addMember(tid, uid, skillId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'addMember', params: { tid, uid, skillId } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[addMember]', err)
      return { code: -1, msg: '添加队员失败' }
    }
  },

  /** 移除队员 */
  async removeMember(tid, uid) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'removeMember', params: { tid, uid } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[removeMember]', err)
      return { code: -1, msg: '移除队员失败' }
    }
  },

  /** 修改队伍招募需求 */
  async setTeamNeeds(tid, newNeeds) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'setTeamNeeds', params: { tid, newNeeds } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[setTeamNeeds]', err)
      return { code: -1, msg: '修改招募需求失败' }
    }
  },

  /** 开启/关闭队伍匹配招募 */
  async setMatchStatus(tid, status) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'setMatchStatus', params: { tid, status } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[setMatchStatus]', err)
      return { code: -1, msg: '修改匹配状态失败' }
    }
  },

  /** 队伍绑定单个赛事cid */
  async addTeamCid(tid, cid) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'addTeamCid', params: { tid, cid } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[addTeamCid]', err)
      return { code: -1, msg: '绑定赛事失败' }
    }
  },

  /** 移除队伍绑定的单个赛事cid */
  async removeTeamCid(tid, cid) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'removeTeamCid', params: { tid, cid } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[removeTeamCid]', err)
      return { code: -1, msg: '解绑赛事失败' }
    }
  },

  /** 批量替换队伍全部赛事cid列表 */
  async setTeamCidList(tid, cidList) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'setTeamCidList', params: { tid, cidList } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[setTeamCidList]', err)
      return { code: -1, msg: '更新赛事列表失败' }
    }
  },

  /** 移除指导老师（队长） */
  async removeAdvisor(tid, uid) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'removeAdvisor', params: { tid, uid } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[removeAdvisor]', err)
      return { code: -1, msg: '移除指导老师失败' }
    }
  },

  /** 修改队伍入队审核条件 */
  async setCondition(tid, condition) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'setCondition', params: { tid, condition } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[setCondition]', err)
      return { code: -1, msg: '修改入队条件失败' }
    }
  },

  /** 修改队伍基础信息(name/intro/maxNum) */
  async updateTeam(tid, newInfo) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'update', params: { tid, newInfo } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[updateTeam]', err)
      return { code: -1, msg: '更新队伍信息失败' }
    }
  },

  /** 删除队伍 */
  async deleteTeam(tid) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'delete', params: { tid } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) await this.loadAllTeams()
      return cloudRes
    } catch (err) {
      console.error('[deleteTeam]', err)
      return { code: -1, msg: '删除队伍失败' }
    }
  }
}

module.exports = teams