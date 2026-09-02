const store = require('../../store/index.js')

Page({
  data: {
    compTeamList: [],
    originCompTeamList: [],
    competitionList: [],
    showPopup: false,
    searchKey: '',
    loading: true,
    loadError: false,
    // ========== 新增 ==========
    tagList: [],          // 所有赛事标签 [{ cid, name }]
    selectedCids: [],     // 当前选中的赛事 cid 列表（单选：长度只能是 0 或 1）
    allSelected: true,    // 是否选中“全部”
    emptyTipShown: false,
    // 下拉展开式标签栏
    allTagList: [],       // 全部赛事标签（含 isActive 状态），用于展开态渲染
    selectedTag: null,    // 头部展示用：当前选中的赛事 {cid, name}，null 表示「全部」
    tagExpanded: false,   // 标签栏是否展开
    tagShowAll: false,    // 展开态下是否显示全部标签（false=最多4行裁剪）
    showMatchPopup: false,
    matchList: [],
    matchLoading: false,
    matchTid: 0,          // 队伍模式：当前匹配推荐对应的队伍 tid（获取候选邮箱用）
    matchUid: 0,          // 个人模式：当前匹配推荐对应的用户 uid
    matchCid: 0,          // 当前匹配推荐对应的赛事 cid
    matchType: 'team',    // 匹配模式：'team'=队伍查看匹配到的个人；'user'=个人查看匹配到的队伍
    isMatch: false,       // 是否从"开始匹配"进入本页（控制"查看匹配结果"按钮）
    matchUserSkills: [],  // 个人模式：当前赛事用户入池的匹配技能 sid 数组（进入匹配流程时提前拉取）
    // ========== 匹配项点击后的操作弹窗 ==========
    showActionPopup: false,
    actionType: '',       // 'invite'=邀请入队 / 'join'=直接加入 / 'apply'=提交申请
    actionTitle: '',
    actionDesc: '',
    actionSkills: [],     // 技能选项 [{ sid, name }]
    actionSkillId: 0,     // 当前选中的技能
    actionPayload: {},    // { tid, uid, cid }
  },

  onLoad: async function (options) {
    this.setData({ isMatch: options.isMatch === 'true' })
    await this.initPageData(options)
    this.unsubscribe = store.subscribe(() => {
      this.refreshTeamList()
    })
    if (options.isMatch === 'true') {
      const cid = Number(options.cid)
      if (isNaN(cid)) return
      const tid = Number(options.tid)
      const uid = Number(options.uid)
      if (!isNaN(tid)) {
        // 队伍模式：队伍查看匹配到的个人
        this.setData({ showMatchPopup: true })
        await this.fetchMatchList(cid, 'team', tid)
      } else if (!isNaN(uid)) {
        // 个人模式：个人查看匹配到的队伍
        this.setData({ showMatchPopup: true })
        await this.fetchMatchList(cid, 'user', uid)
      }
    }
  },

  // 获取匹配推荐列表
  // selfType='team'：队伍查看匹配到的个人；selfType='user'：个人查看匹配到的队伍
  async fetchMatchList(cid, selfType, selfId) {
    this.setData({
      matchLoading: true,
      matchCid: cid,
      matchType: selfType,
      matchTid: selfType === 'team' ? selfId : 0,
      matchUid: selfType === 'user' ? selfId : 0
    })
    try {
      // 【新增】个人模式：进入匹配流程时提前拉取用户入池技能（当前赛事 match_skill），供点击队伍时与队伍需求取交集
      if (selfType === 'user' && selfId) {
        try {
          const poolRes = await wx.cloud.callFunction({
            name: 'matching_poolApi',
            data: { action: 'getMyPool', params: { uid: selfId } }
          })
          const poolData = (poolRes.result && poolRes.result.code === 0 && poolRes.result.data) || []
          const curPoolItem = ((poolData[0] || {}).match_items || []).find(m => Number(m.cid) === Number(cid))
          this.setData({ matchUserSkills: ((curPoolItem && curPoolItem.match_skill) || []).map(Number) })
        } catch (e) {
          console.warn('获取用户匹配技能失败', e)
        }
      }
      const res = await wx.cloud.callFunction({
        name: 'matching_poolApi',
        data: {
          action: 'getMatchList',
          params: { cid, selfType, selfId }
        }
      })
      if (res.result.code === 0) {
        const list = res.result.data || []
        if (selfType === 'team') {
          await this.buildUserMatchList(list)
        } else {
          await this.buildTeamMatchList(list)
        }
      } else {
        wx.showToast({ title: res.result.msg || '获取匹配推荐失败', icon: 'none' })
      }
    } catch (err) {
      console.error('获取匹配推荐失败', err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ matchLoading: false })
    }
  },

  // 队伍模式：组装匹配到的个人列表
  async buildUserMatchList(list) {
    // 提取所有用户 uid
    const uidList = list.filter(item => item.type === 'user').map(item => item.targetId)
    let userMap = {}
    if (uidList.length > 0) {
      const batchRes = await wx.cloud.callFunction({
        name: 'userApi',
        data: { action: 'getBatchUids', params: { uidList } }
      })
      if (batchRes.result.code === 0) {
        batchRes.result.data.forEach(item => {
          const uid = item.userInfo.uid
          userMap[uid] = {
            username: item.userInfo.username,
            avatar: item.userInfo.avatar || '/subPackages/images/user/user.jpg',
            introduction: item.userInfo.introduction || '',
            skills: item.skills || [],
            rating: item.skill_rating || {}
          }
        })
      }
    }
    // 免费版：批量把 cloud:// 头像转成 https 临时链接
    const cloudFiles = Object.values(userMap)
      .map(u => u.avatar)
      .filter(a => a && a.startsWith('cloud://'))
    if (cloudFiles.length > 0) {
      try {
        const urlRes = await wx.cloud.callFunction({
          name: 'getFileUrl',
          data: { fileList: cloudFiles }
        })
        const urlList = (urlRes.result && urlRes.result.fileList) || []
        const urlMap = {}
        urlList.forEach(f => { urlMap[f.fileID] = f.tempFileURL })
        Object.keys(userMap).forEach(uid => {
          const url = urlMap[userMap[uid].avatar]
          if (url) userMap[uid].avatar = url
        })
      } catch (e) {
        console.warn('匹配列表头像转链失败', e)
      }
    }
    // 组装匹配列表
    // 【新增】拉取当前 selfId 队伍的 team_missing，供邀请弹窗与用户匹配技能取交集
    const selfTid = this.data.matchTid
    const selfTeam = selfTid ? store.teams.getByTid(selfTid) : null
    const teamMissing = (selfTeam && selfTeam.team_missing)
      ? Object.entries(selfTeam.team_missing).map(([sid, num]) => ({ sid: Number(sid), num: Number(num) }))
      : []
    const matchList = list.map(item => {
      const uid = item.targetId
      const user = userMap[uid] || { username: '未知用户', avatar: '/subPackages/images/user/user.jpg', skills: [], rating: {}, introduction: '' }
      const matchSkills = item.cur_match_skill || []
      return {
        uid,
        username: user.username,
        avatar: user.avatar,
        introduction: user.introduction || '',
        email: '',
        matchSkills: matchSkills.map(sid => ({
          sid,
          name: store.skills.getNameById(sid) || '未知技能',
          level: user.rating[sid] || 0
        })),
        teamMissing
      }
    })
    this.setData({ matchList })
  },

  // 个人模式：组装匹配到的队伍列表（展示 name/cid_list/leader/intro/team_missing）
  async buildTeamMatchList(list) {
    const tidList = list.filter(item => item.type === 'team').map(item => item.targetId)
    // 队伍详情：拉全量队伍再按 tid 过滤
    let teams = []
    try {
      const teamRes = await wx.cloud.callFunction({
        name: 'teamsApi',
        data: { action: 'getList' }
      })
      if (teamRes.result.code === 0) teams = teamRes.result.data || []
    } catch (e) {
      console.warn('获取队伍列表失败', e)
    }
    const teamMap = {}
    teams.forEach(t => { teamMap[t.tid] = t })

    // 批量查队长名（leader 是 uid）
    const leaderUids = [...new Set(tidList.map(tid => {
      const team = teamMap[tid]
      return team ? Number(team.leader) : 0
    }).filter(uid => uid > 0))]
    let leaderMap = {}
    if (leaderUids.length > 0) {
      try {
        const batchRes = await wx.cloud.callFunction({
          name: 'userApi',
          data: { action: 'getBatchUids', params: { uidList: leaderUids } }
        })
        if (batchRes.result.code === 0) {
          batchRes.result.data.forEach(item => {
            leaderMap[item.userInfo.uid] = item.userInfo.username
          })
        }
      } catch (e) {
        console.warn('获取队长信息失败', e)
      }
    }

    const compList = store.competition.getList()
    const compName = cid => {
      const c = compList.find(x => Number(x.cid) === Number(cid))
      return c ? c.name : `赛事#${cid}`
    }
    const conditionText = cond => (
      Number(cond) === 1 ? '需要审核' : Number(cond) === 2 ? '仅主动邀请' : '无限制'
    )

    const matchList = list
      .filter(item => item.type === 'team')
      .map(item => {
        const tid = item.targetId
        const team = teamMap[tid] || {}
        // 该赛事下的缺人：优先池文档 cur_team_missing，否则队伍 team_missing
        const missing = item.cur_team_missing || team.team_missing || {}
        return {
          tid,
          name: team.name || '未知队伍',
          cid_list: team.cid_list || [],
          compNames: (team.cid_list || []).map(compName),
          compNamesText: (team.cid_list || []).map(compName).join('、'),
          leader: team.leader || 0,
          leaderName: leaderMap[team.leader] || `用户${team.leader || ''}`,
          intro: team.intro || '',
          team_missing: Object.entries(missing).map(([sid, count]) => ({
            sid: Number(sid),
            name: store.skills.getNameById(Number(sid)) || '未知技能',
            count
          })),
          conditionValue: item.cur_condition != null ? Number(item.cur_condition) : Number(team.condition) || 0,
          conditionText: conditionText(item.cur_condition != null ? item.cur_condition : team.condition),
          is_matching: !!team.is_matching
        }
      })
    this.setData({ matchList })
  },

  // 关闭匹配弹窗
  closeMatchPopup() {
    this.setData({ showMatchPopup: false })
  },

  // 点击队伍卡片：跳转队伍详情页（非队员进入后仅可查看队长主页）
  goTeamInfo(e) {
    const tid = e.currentTarget.dataset.tid
    if (!tid) return
    wx.navigateTo({ url: `/subPackages/team/team_info?tid=${tid}` })
  },

  // 点击匹配项：队伍点个人→邀请；个人点队伍→按 condition 加入/申请
  // 【模拟】倒数第2步-选队伍：保留读取与 store 调用，弹窗副作用(setData/showToast)已注释
  async matchItemTap(e) {
    console.log('【模拟】matchItemTap 函数执行')
    const { type, index } = e.currentTarget.dataset
    const item = this.data.matchList[index]
    if (!item) return
    if (type === 'user') {
      // 队伍模式：邀请匹配到的个人
      // 邀请可选技能 = 用户匹配技能 ∩ 队伍缺失技能
      const userSkillSids = (item.matchSkills || []).map(s => Number(s.sid))
      const missingSids = (item.teamMissing || []).map(x => Number(x.sid))
      const interSids = userSkillSids.filter(sid => missingSids.includes(sid))
      const skillList = interSids.map(sid => ({
        sid,
        name: store.skills.getNameById(sid) || '未知技能'
      }))
      if (skillList.length === 0) {
        wx.showToast({ title: '对方技能与队伍缺口不匹配，无法邀请', icon: 'none' })
        return
      }
      this.setData({
        showActionPopup: true,
        actionType: 'invite',
        actionTitle: '邀请入队',
        actionDesc: `是否邀请「${item.username}」以技能「${skillList[0].name}」加入队伍？`,
        actionSkills: skillList,
        actionSkillId: skillList[0].sid,
        actionPayload: { tid: this.data.matchTid, uid: item.uid, cid: this.data.matchCid }
      })
    } else {
      // 个人模式：点击匹配到的队伍（用户场景）
      const uid = this.data.matchUid
      const cond = Number(item.conditionValue)
      // if (cond === 2) {
      //   wx.showToast({ title: '该队伍仅主动邀请，无法匹配加入', icon: 'none' })
      //   return
      // }
      // 入队技能选项 = 用户入池技能 ∩ 队伍所需技能（交集），渲染可选技能
      const userMatchSkills = (this.data.matchUserSkills || []).map(Number)
      const teamNeedSids = (item.team_missing || []).map(x => Number(x.sid))
      const skillList = userMatchSkills
        .filter(sid => teamNeedSids.includes(Number(sid)))
        .map(sid => ({
          sid: Number(sid),
          name: store.skills.getNameById(Number(sid)) || '未知技能'
        }))
      if (skillList.length === 0) {
        wx.showToast({ title: '你入池的技能与该队伍需求不匹配', icon: 'none' })
        return
      }
      const isFree = cond === 0
      // 具体执行（注释）：打开加入/申请弹窗
      this.setData({
        showActionPopup: true,
        actionType: isFree ? 'join' : 'apply',
        actionTitle: isFree ? '加入队伍' : '提交入队申请',
        actionDesc: isFree
          ? `是否以技能「${skillList[0].name}」加入队伍「${item.name}」？`
          : `是否以技能「${skillList[0].name}」提交入队申请？队长审核通过后即可加入。`,
        actionSkills: skillList,
        actionSkillId: skillList[0].sid,
        actionPayload: { tid: item.tid, uid, cid: this.data.matchCid }
      })
    }
  },

  // 选择入队技能
  // 【模拟】倒数第2步-选技能：仅 setData 副作用，已注释
  selectActionSkill(e) {
    console.log('【模拟】selectActionSkill 函数执行')
    const sid = Number(e.currentTarget.dataset.sid)
    if (!sid) return
    const { actionSkills, actionDesc } = this.data
    const skill = actionSkills.find(s => s.sid === sid)
    if (!skill) return
    // 具体执行（注释）：更新选中技能与弹窗文案
    this.setData({
      actionSkillId: sid,
      actionDesc: actionDesc.replace(/技能「[^」]*」/, `技能「${skill.name}」`)
    })
  },

  // 关闭操作弹窗
  closeActionPopup() {
    this.setData({ showActionPopup: false })
  },

  // 确认操作：邀请/加入/申请
  // 【模拟】倒数第1步-发出申请/直接入队：保留云函数调用与 store 刷新调用，toast/弹窗/跳转副作用已注释
  async confirmAction() {
    console.log('【模拟】confirmAction 函数执行')
    const { actionType, actionSkillId, actionPayload } = this.data
    // if (!actionSkillId) {
    //   wx.showToast({ title: '请选择技能', icon: 'none' })
    //   return
    // }
    const { tid, uid, cid } = actionPayload
    // if (!tid || !uid || !cid) return
    // wx.showLoading({ title: '处理中...', mask: true })
    try {
      if (actionType === 'invite' || actionType === 'apply') {
        // 发出申请/邀请 → 云函数 requestApi.create（调用保留）
        const res = await wx.cloud.callFunction({
          name: 'requestApi',
          data: {
            action: 'create',
            params: { type: actionType, tid, uid, cid, skillId: actionSkillId }
          }
        })
        // 副作用（注释）：loading/toast/关闭弹窗
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: actionType === 'invite' ? '已发出邀请' : '申请已提交', icon: 'success' })
          this.setData({ showActionPopup: false, showMatchPopup: false })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '操作失败', icon: 'none' })
        }
      } else if (actionType === 'join') {
        // 直接入队 → 云函数 teamsApi.addMember（调用保留）
        const res = await wx.cloud.callFunction({
          name: 'teamsApi',
          data: { action: 'addMember', params: { tid, uid, skillId: actionSkillId } }
        })
        // 副作用（注释）：loading/toast/关闭弹窗/延迟跳转
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '已加入队伍', icon: 'success' })
          this.setData({ showActionPopup: false, showMatchPopup: false })
          // 加入成功后刷新 store（调用保留）
          await Promise.all([store.user.loadUser(), store.teams.loadAllTeams()])
          wx.navigateTo({ url: `/subPackages/team/team_info?tid=${tid}` })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '加入失败', icon: 'none' })
        }
      }
    } catch (err) {
      // 副作用（注释）：loading/提示
      // console.error('操作失败', err)
      // wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  // "查看匹配结果"：重新打开匹配推荐弹窗并刷新
  openMatchResult() {
    const { matchCid, matchTid, matchUid, matchType } = this.data
    if (!matchCid) {
      wx.showToast({ title: '暂无匹配结果', icon: 'none' })
      return
    }
    const selfId = matchType === 'team' ? matchTid : matchUid
    if (!selfId) {
      wx.showToast({ title: '暂无匹配结果', icon: 'none' })
      return
    }
    this.setData({ showMatchPopup: true })
    this.fetchMatchList(matchCid, matchType, selfId)
  },

  // 获取匹配候选队友邮箱（匹配场景：云函数 getContact 校验请求方是本队成员即可）
  async getMatchContact(e) {
    const { uid } = e.currentTarget.dataset
    const tid = this.data.matchTid
    if (!uid || !tid) return
    wx.showLoading({ title: '获取中...', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: {
          action: 'getContact',
          params: { tid, targetUid: uid, scope: 'match' }
        }
      })
      wx.hideLoading()
      if (res.result && res.result.code === 0 && res.result.data) {
        const email = res.result.data.email || ''
        if (!email) {
          wx.showToast({ title: '对方未填写邮箱', icon: 'none' })
          return
        }
        const matchList = this.data.matchList.map(item => {
          if (String(item.uid) === String(uid)) {
            return { ...item, email }
          }
          return item
        })
        this.setData({ matchList })
        wx.setClipboardData({
          data: email,
          success: () => wx.showToast({ title: '已复制邮箱' })
        })
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '获取失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('获取邮箱失败', err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  // 复制匹配卡片上已展示的邮箱
  copyMatchEmail(e) {
    const { uid } = e.currentTarget.dataset
    const item = this.data.matchList.find(i => String(i.uid) === String(uid))
    const email = item && item.email
    if (!email) return
    wx.setClipboardData({
      data: email,
      success: () => wx.showToast({ title: '已复制邮箱' })
    })
  },

  async initPageData(options) {
    try {
      this.setData({ loading: true, loadError: false })
      const compList = store.competition.getList()
      this.setData({ competitionList: compList })
      // allTagList（只含有队伍的赛事标签）统一在 refreshTeamList 中生成
      this.refreshTeamList()
      this.handleRouteFilter(options)
    } catch (err) {
      console.error("页面初始化失败：", err)
      this.setData({ loadError: true })
    } finally {
      this.setData({ loading: false })
    }
  },

  refreshTeamList() {
    const compList = store.competition.getList()
    const rawTeams = store.teams.getList()
    // 【新增】招募大厅不展示仅邀请(condition===2)与已招满的队伍
    // 招满判断：当前成员数(含队长) >= maxNum
    const teamList = rawTeams.filter(team => {
      if (Number(team.condition) === 2) return false
      const memberCnt = team.members ? Object.keys(team.members).length : 0
      if (memberCnt >= Number(team.maxNum || 0)) return false
      return true
    })

    const formatTeamSkill = (team) => {
      const skillCount = {}
      Object.values(team.members).forEach(skillId => {
        skillCount[skillId] = (skillCount[skillId] || 0) + 1
      })
      return {
        ...team,
        skillHaveList: Object.entries(skillCount).map(([skillId, count]) => ({
          skillId: Number(skillId),
          skillName: store.skills.getNameById(Number(skillId)),
          count
        })),
        skillMissingList: Object.entries(team.team_missing || {}).map(([skillId, count]) => ({
          skillId: Number(skillId),
          skillName: store.skills.getNameById(Number(skillId)),
          count
        }))
      }
    }

    const origin = compList.map(comp => ({
      cid: comp.cid,
      compName: comp.name,
      teams: teamList
        .filter(team => team.cid_list.includes(comp.cid))
        .map(team => formatTeamSkill(team))
    })).filter(item => item.teams.length > 0)

    // 【新增】标签栏只放有队伍的赛事（与 originCompTeamList 保持同步，含 isActive 状态）
    const { allSelected, selectedCids, selectedTag } = this.data
    const allTagList = origin.map(item => ({
      cid: Number(item.cid),
      name: item.compName,
      isActive: !allSelected && selectedCids.includes(Number(item.cid))
    }))

    // 当前选中的赛事若已无队伍，重置为「全部」
    const selectedCid = (!allSelected && selectedCids.length > 0) ? Number(selectedCids[0]) : 0
    const selectionValid = selectedCid === 0 || allTagList.some(t => t.cid === selectedCid)

    this.setData({
      originCompTeamList: origin,
      allTagList,
      allSelected: selectionValid ? allSelected : true,
      selectedCids: selectionValid ? selectedCids : [],
      selectedTag: selectionValid ? selectedTag : null
    })
    // 应用当前筛选条件
    this.applyFilters()
  },

  // ========== 新增：统一应用所有筛选 ==========
  applyFilters(fromUserAction = false) {
    const { originCompTeamList, selectedCids, searchKey, allSelected, allTagList } = this.data

    // 1. 更新标签激活状态
    const updatedTagList = allTagList.map(item => ({
      ...item,
      isActive: !allSelected && selectedCids.includes(item.cid)
    }))

    // 2. 赛事筛选
    let result = [...originCompTeamList]
    if (!allSelected && selectedCids.length > 0) {
      result = result.filter(item => selectedCids.includes(item.cid))
    }

    // 3. 搜索框筛选
    if (searchKey) {
      const lowKey = searchKey.toLowerCase()
      result = result.filter(item => {
        const matchComp = item.compName.toLowerCase().includes(lowKey)
        const matchTeam = item.teams.some(team => team.name?.toLowerCase().includes(lowKey))
        return matchComp || matchTeam
      })
    }

    // 4. 用户操作弹窗提示（保持不变）
    if (fromUserAction && result.length === 0) {
      const hasFilter = !allSelected || selectedCids.length > 0 || searchKey.trim() !== ''
      if (hasFilter) {
        let title = '当前赛事下暂无队伍'
        if (searchKey.trim() !== '') {
          title = '未找到匹配队伍'
        }
        wx.showToast({ title, icon: 'none', duration: 1500 })
      }
    }

    // 5. 更新数据
    // 【修复】仅当 isActive 实际变化时才 setData allTagList，
    // 避免每次筛选都 setData 新数组导致 wx:for 无谓重渲染（真机上会触发
    // 标签栏区域渲染抖动/出现空白）。
    const setDataPayload = { compTeamList: result }
    const tagsChanged = updatedTagList.some((item, i) => item.isActive !== allTagList[i].isActive)
    if (tagsChanged) setDataPayload.allTagList = updatedTagList
    this.setData(setDataPayload)
  },

  // 搜索输入监听
  onSearchInput(e) {
    const key = (e.detail.value || '').trim()
    this.setData({ searchKey: key }, () => {
      if (key === '') {
        this.applyFilters()        // 清空时不弹窗
      } else {
        this.applyFilters(true)    // 有内容时弹窗
      }
    })
  },

  // 清空搜索框
  clearSearch() {
    this.setData({ searchKey: '' }, () => this.applyFilters())
  },

  // ========== 修改：标签点击切换（单选：再次点已选则取消，切换标签后自动收起） ==========
  onTagTap(e) {
    const rawCid = e.currentTarget.dataset.cid
    if (rawCid === 'all') {
      // 点「全部」：重置 + 收起
      this.setData({
        allSelected: true,
        selectedCids: [],
        selectedTag: null,
        tagExpanded: false, tagShowAll: false
      }, this.applyFilters)
      return
    }

    const cid = Number(rawCid)
    if (isNaN(cid)) return

    // 检查该赛事下是否有队伍
    const hasTeam = this.data.originCompTeamList.some(item => item.cid === cid && item.teams.length > 0)
    if (!hasTeam) {
      wx.showToast({ title: '当前赛事下暂无队伍', icon: 'none', duration: 1500 })
      return
    }

    const targetTag = this.data.allTagList.find(item => item.cid === cid)
    if (!targetTag) return

    // 单选逻辑：再次点已选标签 = 取消（恢复全部）；否则切换
    const isCurrentlySelected = this.data.selectedCids.length === 1 && this.data.selectedCids[0] === cid
    if (isCurrentlySelected) {
      this.setData({
        allSelected: true,
        selectedCids: [],
        selectedTag: null,
        tagExpanded: false, tagShowAll: false
      }, this.applyFilters)
    } else {
      this.setData({
        allSelected: false,
        selectedCids: [cid],
        selectedTag: { cid: targetTag.cid, name: targetTag.name },
        tagExpanded: false, tagShowAll: false   // 选中后自动收起
      }, this.applyFilters)
    }
  },

  // 切换标签栏展开/收起（收起时同时重置"显示全部"状态）
  toggleTagExpand() {
    const tagExpanded = !this.data.tagExpanded
    this.setData(tagExpanded ? { tagExpanded } : { tagExpanded, tagShowAll: false })
  },

  // 展开态内：切换"显示全部标签 / 收起为最多4行"
  toggleTagShowAll() {
    this.setData({ tagShowAll: !this.data.tagShowAll })
  },

  handleRouteFilter(options) {
    const isMatch = options.isMatch === 'true'
    // 【新增】从 team_push / user_push 进入（匹配模式）：仅锁定赛事标签，搜索框不显示赛事名
    if (isMatch) {
      const cid = Number(options.cid)
      if (isNaN(cid) || cid <= 0) return
      const targetComp = this.data.competitionList.find(item => item.cid === cid)
      if (targetComp) {
        this.setData({
          allSelected: false,
          selectedCids: [cid],
          selectedTag: { cid: targetComp.cid, name: targetComp.name },
          searchKey: ''
        }, () => {
          this.applyFilters()
        })
      }
      return
    }
    if (!options.targetId || !options.type) return
    const targetId = Number(options.targetId)
    const filterType = options.type

    if (filterType === 'cid') {
      // 跳转携带 cid：自动选中该赛事标签
      const targetComp = this.data.competitionList.find(item => item.cid === targetId)
      if (targetComp) {
        this.setData({
          allSelected: false,
          selectedCids: [targetId],
          selectedTag: { cid: targetComp.cid, name: targetComp.name },
          searchKey: targetComp.name
        }, () => {
          this.applyFilters()
        })
      }
    } else if (filterType === 'tid') {
      const targetTeam = store.teams.getByTid(targetId)
      if (targetTeam) {
        // 查找该队伍所属赛事，单选：自动选中第一个赛事标签
        const comps = this.data.competitionList.filter(c => targetTeam.cid_list.includes(c.cid))
        if (comps.length > 0) {
          const firstComp = comps[0]
          this.setData({
            allSelected: false,
            selectedCids: [firstComp.cid],
            selectedTag: { cid: firstComp.cid, name: firstComp.name },
            searchKey: targetTeam.name
          }, () => {
            this.applyFilters()
            // 再精确过滤到单个队伍
            setTimeout(() => {
              const { originCompTeamList } = this.data
              const onlyTargetTeam = originCompTeamList
                .map(item => ({
                  ...item,
                  teams: item.teams.filter(t => t.tid === targetId)
                }))
                .filter(item => item.teams.length > 0)
              this.setData({ compTeamList: onlyTargetTeam })
            }, 0)
          })
        }
      }
    }
  },

  // 下拉刷新
  onPullDownRefresh: async function () {
    await this.initPageData(this.options)
    wx.stopPullDownRefresh()
  },

  retryLoad() {
    this.initPageData(this.options)
  },

  onUnload() {
    if (typeof this.unsubscribe === 'function') {
      this.unsubscribe()
    }
  }
})