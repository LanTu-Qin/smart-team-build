// subPackages/user/user_push.js
// 用户匹配配置页：赛事（只读） + 选择参赛技能（多选，带等级） + 进入匹配池
const store = require('../../store/index')

Page({
  data: {
    cid: 0,
    compName: '',
    compStatus: '',
    skillOptions: [],   // 用户拥有的技能 [{ sid, name, level, checked }]
    selectedSkills: [], // 已选技能 sid 数组
    submitting: false
  },

  onLoad(options) {
    const cid = Number(options.cid)
    if (!cid) {
      wx.showToast({ title: '缺少赛事ID', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    // 【修改】重复参赛判定基于“用户当前所属队伍”，onGoing_cid 是参赛记录（个人报名会写入），不再拦截
    const userState = store.user.getUserInfo()
    const onGoingCids = userState.onGoing_cid || []
    // 1) 是否已达同时参赛上限（与 teamsApi 后端 MAX_ONGOING_CID=5 保持一致）
    const MAX_ONGOING_CID = 5
    if (onGoingCids.length >= MAX_ONGOING_CID) {
      wx.showToast({ title: `同时参赛最多${MAX_ONGOING_CID}场，已达上限`, icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    // 2) 用户参与的队伍中已有队伍绑定该赛事（cid_list 含当前 cid）→ 拦截
    const tidList = userState.tid_list || []
    const myTeams = (store.teams.getList() || []).filter(t => tidList.includes(t.tid))
    const boundTeam = myTeams.find(t => (t.cid_list || []).includes(cid))
    if (boundTeam) {
      wx.showToast({ title: '您已有队伍参加该赛事，请勿重复匹配', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    this.setData({ cid })
    this.initCompInfo(cid)
    this.initSkillOptions()
  },

  // 赛事信息（只读，由赛事详情页传入，不可更改）
  initCompInfo(cid) {
    const list = store.competition.getList() || []
    const comp = list.find(item => Number(item.cid) === Number(cid))
    this.setData({
      compName: comp ? (comp.name || comp.title || '未知赛事') : '未知赛事',
      compStatus: comp ? (comp.status || '') : ''
    })
  },

  // 组装用户拥有的技能（带等级渲染）
  initSkillOptions() {
    const userState = store.user.getUserInfo()
    const rating = userState.userInfo.skill_rating || {}
    const skillIds = userState.skills || []
    const skillOptions = skillIds
      .map(sid => ({
        sid: Number(sid),
        name: store.skills.getNameById(sid),
        level: rating[sid] || 0
      }))
      .filter(item => item.name !== '未知技能')
    this.setData({ skillOptions })
  },

  // 点击技能卡片：多选切换
  toggleSkill(e) {
    const sid = Number(e.currentTarget.dataset.sid)
    const { skillOptions, selectedSkills } = this.data
    const idx = selectedSkills.indexOf(sid)
    if (idx > -1) {
      selectedSkills.splice(idx, 1)
    } else {
      selectedSkills.push(sid)
    }
    this.setData({
      selectedSkills,
      skillOptions: skillOptions.map(item => ({
        ...item,
        checked: selectedSkills.includes(item.sid)
      }))
    })
  },

  // 完成：进入匹配池
  async submitMatch() {
    const { cid, selectedSkills, submitting } = this.data
    if (submitting) return
    const userState = store.user.getUserInfo()
    const uid = userState.userInfo.uid
    if (!userState.isLogin || !uid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    // 【修改】提交时同样用“所属队伍”校验（防止绕过 goMatch 直达本页）
    const onGoingCids = userState.onGoing_cid || []
    const MAX_ONGOING_CID = 5
    if (onGoingCids.length >= MAX_ONGOING_CID) {
      wx.showToast({ title: `同时参赛最多${MAX_ONGOING_CID}场，已达上限`, icon: 'none' })
      return
    }
    const tidList = userState.tid_list || []
    const myTeams = (store.teams.getList() || []).filter(t => tidList.includes(t.tid))
    const boundTeam = myTeams.find(t => (t.cid_list || []).includes(cid))
    if (boundTeam) {
      wx.showToast({ title: '您已有队伍参加该赛事，请勿重复匹配', icon: 'none' })
      return
    }
    if (selectedSkills.length === 0) {
      wx.showToast({ title: '请至少选择一个技能', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '进入匹配池...' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'matching_poolApi',
        data: {
          action: 'enterPool',
          params: {
            type: 'user',
            targetId: uid,
            cid,
            match_skill: selectedSkills
          }
        }
      })
      if (res.result.code === 0) {
        // 刷新用户匹配状态缓存
        await store.user.loadUser()
        wx.hideLoading()
        wx.showToast({ title: '已进入匹配池', icon: 'success' })
        // 跳转到队伍列表页展示匹配结果（个人模式：查看匹配到的队伍）
        // isMatch=true 自动弹出匹配推荐弹窗；targetId+type 让列表聚焦当前赛事
        setTimeout(() => {
          wx.redirectTo({
            url: `/subPackages/team/team_list?cid=${cid}&uid=${uid}&targetId=${cid}&type=cid&isMatch=true`
          })
        }, 800)
      } else {
        throw new Error(res.result.msg || '入池失败')
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '入池失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
