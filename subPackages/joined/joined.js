// subPackages/joined/joined.js
// 我的消息中心：5 类消息
//   1. 系统通知（成员退出等系统消息）
//   2. 我的队伍收到的入队申请（队长视角，需处理）
//   3. 我收到的入队邀请（个人被邀请，需处理）
//   4. 我发出的入队申请（申请人视角，待审核）
//   5. 我发出的入队邀请（队长视角，等待对方响应）
const store = require('../../store/index.js')

Page({
  data: {
    isLogin: false,
    // 1. 系统通知
    notifyList: [],
    notifyCount: 0,
    // 2. 我的队伍收到的入队申请（队长视角）
    applyReceivedList: [],
    applyReceivedCount: 0,
    // 3. 我收到的入队邀请（个人被邀请）
    inviteList: [],
    inviteCount: 0,
    // 4. 我发出的入队申请（申请人视角）
    applyList: [],
    applyCount: 0,
    // 5. 我发出的入队邀请（队长视角）
    inviteSentList: [],
    inviteSentCount: 0,
    loading: false
  },

  onShow() {
    this.loadRequests()
  },

  onPullDownRefresh() {
    this.loadRequests().finally(() => wx.stopPullDownRefresh())
  },

  // 拉取所有消息（并行请求 getByUser + getByCaptain）
  async loadRequests() {
    const userState = store.user.getUserInfo()
    if (!userState.isLogin || !userState.userInfo.uid) {
      this.setData({
        isLogin: false,
        notifyList: [],
        applyReceivedList: [],
        inviteList: [],
        applyList: [],
        inviteSentList: [],
        notifyCount: 0,
        applyReceivedCount: 0,
        inviteCount: 0,
        applyCount: 0,
        inviteSentCount: 0
      })
      return
    }
    const uid = userState.userInfo.uid
    this.setData({ loading: true, isLogin: true })
    try {
      const [userRes, captainRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'requestApi', data: { action: 'getByUser', params: { uid } } }),
        wx.cloud.callFunction({ name: 'requestApi', data: { action: 'getByCaptain', params: { uid } } })
      ])
      // 个人相关（uid=自己）
      const userData = (userRes.result && userRes.result.code === 0) ? (userRes.result.data || []) : []
      const decorate = (item) => ({
        ...item,
        isAdvisor: item.subType === 'advisor',   // 指导老师邀请
        skillName: item.subType === 'advisor'
          ? '担任指导老师'
          : (item.skillId
              ? (store.skills.getNameById(Number(item.skillId)) || '未知技能')
              : '默认技能')
      })
      const notifyList = userData.filter(r => r.type === 'notify').map(decorate)
      const inviteList = userData.filter(r => r.type === 'invite').map(decorate)
      const applyList = userData.filter(r => r.type === 'apply').map(decorate)
      // 队长相关（tid IN 我作为队长的队伍）
      const capData = (captainRes.result && captainRes.result.code === 0) ? (captainRes.result.data || {}) : {}
      const applyReceivedList = (capData.appliesReceived || []).map(decorate)
      const inviteSentList = (capData.invitesSent || []).map(decorate)
      this.setData({
        notifyList,
        applyReceivedList,
        inviteList,
        applyList,
        inviteSentList,
        notifyCount: notifyList.length,
        applyReceivedCount: applyReceivedList.length,
        inviteCount: inviteList.length,
        applyCount: applyList.length,
        inviteSentCount: inviteSentList.length,
        loading: false
      })
    } catch (err) {
      console.error('获取请求列表失败', err)
      this.setData({ loading: false })
    }
  },

  // 系统通知：跳队伍详情 / 标记已读
  async handleNotify(e) {
    const { id, action, tid } = e.currentTarget.dataset
    if (action === 'go') {
      if (!tid) return
      wx.navigateTo({ url: `/subPackages/team/team_info?tid=${tid}` })
      return
    }
    if (!id) return
    try {
      const res = await wx.cloud.callFunction({
        name: 'requestApi',
        data: { action: 'handle', params: { requestId: id, action: 'reject' } }
      })
      if (res.result.code === 0) this.loadRequests()
    } catch (err) {
      console.error('标记提醒已读失败', err)
    }
  },

  // 我收到的邀请：accept / reject
  async handleInvite(e) {
    const { id, action } = e.currentTarget.dataset
    if (!id) return
    const target = (this.data.inviteList || []).find(r => r._id === id)
    const isAdvisor = !!(target && target.subType === 'advisor')
    wx.showLoading({ title: '处理中...', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'requestApi',
        data: { action: 'handle', params: { requestId: id, action } }
      })
      wx.hideLoading()
      if (res.result.code === 0) {
        const okTitle = action === 'accept'
          ? (isAdvisor ? '已接受，成为指导老师' : '已加入队伍')
          : '已拒绝'
        wx.showToast({ title: okTitle, icon: 'success' })
        if (action === 'accept') {
          try {
            await Promise.all([store.user.loadUser(), store.teams.loadAllTeams()])
          } catch (err) {
            console.warn('接受邀请后刷新数据失败', err)
          }
        }
        this.loadRequests()
      } else {
        wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' })
        this.loadRequests()
      }
    } catch (err) {
      wx.hideLoading()
      console.error('处理邀请失败', err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  // 【新增】我的队伍收到的申请：accept / reject
  async handleApplyReceived(e) {
    const { id, action } = e.currentTarget.dataset
    if (!id) return
    wx.showLoading({ title: '处理中...', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'requestApi',
        data: { action: 'handle', params: { requestId: id, action } }
      })
      wx.hideLoading()
      if (res.result.code === 0) {
        wx.showToast({ title: action === 'accept' ? '已同意入队' : '已拒绝', icon: 'success' })
        try {
          await store.teams.loadAllTeams()
        } catch (err) {
          console.warn('刷新队伍失败', err)
        }
        this.loadRequests()
      } else {
        wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' })
        this.loadRequests()
      }
    } catch (err) {
      wx.hideLoading()
      console.error('处理申请失败', err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  // 跳转队伍详情
  goTeamDetail(e) {
    const tid = e.currentTarget.dataset.tid
    if (!tid) return
    wx.navigateTo({ url: `/subPackages/team/team_info?tid=${tid}` })
  },

  goLogin() {
    wx.navigateTo({ url: '/subPackages/user/user' })
  }
})
