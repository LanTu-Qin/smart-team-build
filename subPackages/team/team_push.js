// const userStore = require('../../store/user.js');
// const teamStore = require('../../store/teams.js');
// const skillsStore = require('../../store/skills.js');
// const competitionStore = require('../../store/competition.js');
// const store = require('../../store/index');

// Page({
//   data: {
//     formData: {
//       name: '',
//       cid_list: [],
//       selectedComps: [], // 新增：已选赛事的完整信息(id+name)，用于渲染
//       cidIndex: [],
//       leader: null,
//       leaderSkillIndex: 0,
//       teamNeedsList: [],
//       addNeedIndex: 0,
//       condition: 0,
//       conditionIndex: 0,
//       conditionDesc: '',
//       intro: '',
//       is_matching: true
//     },
//     autoMaxNum: 0,
//     cidOptions: [],
//     conditionOptions: [
//       { value: 0, name: '自由加入' },
//       { value: 1, name: '审核加入' },
//       { value: 2, name: '仅邀请加入' }
//     ],
//     userSkills: [],
//     allSkills: [],
//     formIsValid: false,
//     compSearchValue: '',
//     compSearchResult: [],
//     showCompResult: false,
//     loading: false,
//     presetCid: null // 暂存跳转携带的cid
//   },

//   onLoad(options) {
//     // 解析跳转携带的赛事cid
//     if (options && options.cid) {
//       this.data.presetCid = Number(options.cid);
//     }
//     this.unsubscribe = store.subscribe(() => {
//       this.syncAllCacheData();
//     });
//     this.initPageData();
//   },

//   onShow() {
//     this.syncAllCacheData();
//   },

//   async syncAllCacheData() {
//     // 联动用户模块：登录态校验
//     const userState = userStore.getUserInfo();
//     if (!userState.isLogin) {
//       wx.showToast({
//         title: '请先登录后创建队伍',
//         icon: 'none'
//       });
//       setTimeout(() => {
//         wx.navigateBack();
//       }, 1500);
//       return;
//     }

//     const compList = competitionStore.getList();
//     const skillArr = skillsStore.getAll();
//     if (!compList.length || !skillArr.length) {
//       this.setData({ loading: true });
//       try {
//         await Promise.all([
//           competitionStore.loadCompetition(),
//           skillsStore.loadSkills(),
//           teamStore.loadAllTeams()
//         ]);
//       } catch (err) {
//         wx.showToast({
//           title: '数据加载失败',
//           icon: 'none'
//         });
//         console.error('缓存加载异常', err);
//       } finally {
//         this.setData({ loading: false });
//       }
//     }
//     this.syncSkillsData();
//     this.syncCompetitionData();
//     this.setData({
//       'formData.conditionDesc': this.data.conditionOptions[0].name
//     }, this.checkFormValid);
//   },

//   initPageData() {
//     this.syncAllCacheData();
//   },

//   syncSkillsData() {
//     const allSkills = skillsStore.getAll();
//     const userState = userStore.getUserInfo();
//     const userSkills = allSkills.filter(skill => 
//       userState.skills.includes(skill.sid)
//     );
    
//     const defaultLeader = userSkills[0] || null;
//     // 初始化需求列表：队长技能自动加入，标记为队长担任
//     const initNeeds = defaultLeader ? [{
//       sid: defaultLeader.sid,
//       skillName: defaultLeader.name,
//       num: 1,
//       isLeader: true // 核心标记：不可删除、不可减员
//     }] : [];
  
//     this.setData({
//       allSkills,
//       userSkills,
//       'formData.leader': defaultLeader,
//       'formData.teamNeedsList': initNeeds
//     }, () => {
//       this.calcAutoMaxNum();
//       this.checkFormValid();
//     });
//   },

//   syncCompetitionData() {
//     const competitionList = competitionStore.getList();
//     const cidOptions = competitionList.map(item => ({
//       id: item.cid,
//       name: item.name
//     }));
    
//     this.setData({ cidOptions }, () => {
//       // 处理跳转携带的预设cid，自动加入已选
//       const presetCid = this.data.presetCid;
//       if (presetCid) {
//         const { cid_list, selectedComps } = this.data.formData;
//         if (!cid_list.includes(presetCid)) {
//           const compItem = cidOptions.find(item => item.id === presetCid);
//           if (compItem) {
//             this.setData({
//               'formData.cid_list': [...cid_list, presetCid],
//               'formData.selectedComps': [...selectedComps, compItem]
//             });
//           }
//         }
//         this.data.presetCid = null; // 用完清空，避免重复处理
//       }
//       this.checkFormValid();
//     });
//   },

//   handleCompSearchInput(e) {
//     const value = e.detail.value.trim();
//     this.setData({
//       compSearchValue: value
//     });
//     if (!value) {
//       this.setData({
//         compSearchResult: [],
//         showCompResult: false
//       });
//       return;
//     }
//     const filterResult = this.data.cidOptions.filter(item => {
//       const nameMatch = item.name.toLowerCase().includes(value.toLowerCase());
//       const cidMatch = item.id.toString().includes(value);
//       return nameMatch || cidMatch;
//     });
//     const { cid_list } = this.data.formData;
//     const finalResult = filterResult.filter(item => !cid_list.includes(item.id));
//     this.setData({
//       compSearchResult: finalResult,
//       showCompResult: true
//     });
//   },

//   selectCompItem(e) {
//     const { cid } = e.currentTarget.dataset;
//     const { cid_list, selectedComps } = this.data.formData;
//     if (cid_list.includes(cid)) return;

//     const compItem = this.data.cidOptions.find(item => item.id === cid);
//     const newCidList = [...cid_list, cid];
//     const newSelectedComps = [...selectedComps, compItem];

//     this.setData({
//       'formData.cid_list': newCidList,
//       'formData.selectedComps': newSelectedComps,
//       compSearchValue: '',
//       compSearchResult: [],
//       showCompResult: false
//     }, this.checkFormValid);
//   },

//   // 赛事标签删除：点击整个标签触发
//   removeCompTag(e) {
//     const { cid } = e.currentTarget.dataset;
//     const { cid_list, selectedComps } = this.data.formData;
//     const newCidList = cid_list.filter(item => item !== cid);
//     const newSelectedComps = selectedComps.filter(item => item.id !== cid);
//     this.setData({
//       'formData.cid_list': newCidList,
//       'formData.selectedComps': newSelectedComps
//     }, this.checkFormValid);
//   },

//   calcAutoMaxNum() {
//     const { teamNeedsList } = this.data.formData;
//     // 队长已包含在列表中，直接对所有需求人数求和
//     const sum = teamNeedsList.reduce((total, item) => total + item.num, 0);
//     this.setData({ autoMaxNum: sum });
//     return sum;
//   },

//   handleInputChange(e) {
//     const { key } = e.currentTarget.dataset;
//     this.setData({
//       [`formData.${key}`]: e.detail.value
//     }, this.checkFormValid);
//   },

//   handleLeaderSkillChange(e) {
//     const { value } = e.detail;
//     const leader = this.data.userSkills[value];
//     const teamNeedsList = [...this.data.formData.teamNeedsList];
    
//     // 移除旧的队长技能项
//     const newNeeds = teamNeedsList.filter(item => !item.isLeader);
    
//     // 插入新的队长技能项
//     if (leader) {
//       newNeeds.unshift({
//         sid: leader.sid,
//         skillName: leader.name,
//         num: 1,
//         isLeader: true
//       });
//     }
  
//     this.setData({
//       'formData.leaderSkillIndex': value,
//       'formData.leader': leader,
//       'formData.teamNeedsList': newNeeds
//     }, () => {
//       this.calcAutoMaxNum();
//       this.checkFormValid();
//     });
//   },

//   handleConditionChange(e) {
//     const { value } = e.detail;
//     const condition = this.data.conditionOptions[value].value;
//     const conditionDesc = this.data.conditionOptions[value].name;
//     this.setData({
//       'formData.conditionIndex': value,
//       'formData.condition': condition,
//       'formData.conditionDesc': conditionDesc
//     }, this.checkFormValid);
//   },

//   handleSwitchChange(e) {
//     const { key } = e.currentTarget.dataset;
//     this.setData({
//       [`formData.${key}`]: e.detail.value
//     });
//   },

//   addNeedItem(e) {
//     const { value } = e.detail;
//     const skill = this.data.allSkills[value];
//     const { teamNeedsList } = this.data.formData;
    
//     // 已存在的技能（包括队长技能）不能重复添加
//     if (teamNeedsList.some(item => item.sid === skill.sid)) {
//       wx.showToast({
//         title: '该技能已添加',
//         icon: 'none'
//       });
//       return;
//     }
  
//     teamNeedsList.push({
//       sid: skill.sid,
//       skillName: skill.name,
//       num: 1,
//       isLeader: false // 普通招募需求
//     });
  
//     this.setData({
//       'formData.teamNeedsList': teamNeedsList,
//       'formData.addNeedIndex': 0
//     }, () => {
//       this.calcAutoMaxNum();
//       this.checkFormValid();
//     });
//   },

// // 仅列出修改/新增的方法，其余保持不变

//   // 1. 人数减少：增加边界校验，队长技能最低为1，普通技能最低为1
//   minusNeedNum(e) {
//     const { sid } = e.currentTarget.dataset;
//     const { teamNeedsList } = this.data.formData;
    
//     const newList = teamNeedsList.map(item => {
//       // 队长技能：最低保留1人（队长本身）
//       if (item.isLeader) {
//         return item.num > 1 ? { ...item, num: item.num - 1 } : item;
//       }
//       // 普通技能：最低保留1人
//       if (item.sid === sid && item.num > 1) {
//         return { ...item, num: item.num - 1 };
//       }
//       return item;
//     });

//     this.setData({
//       'formData.teamNeedsList': newList
//     }, () => {
//       this.calcAutoMaxNum();
//     });
//   },

//   // 2. 删除需求：统一用isLeader判断，队长技能不可删
//   removeNeedItem(e) {
//     const { sid } = e.currentTarget.dataset;
//     const target = this.data.formData.teamNeedsList.find(i => i.sid === sid);
    
//     if (target?.isLeader) {
//       wx.showToast({
//         title: '队长技能不能删除',
//         icon: 'none'
//       });
//       return;
//     }

//     const newList = this.data.formData.teamNeedsList.filter(i => i.sid !== sid);
//     this.setData({
//       'formData.teamNeedsList': newList
//     }, () => {
//       this.calcAutoMaxNum();
//       this.checkFormValid();
//     });
//   },

//   // 3. 新增：计算已有定位和缺失定位（供WXML渲染）
//   // 可以在setData时同步计算，也可以在WXML中直接用表达式，这里封装成工具方法
//   getPositionStatus() {
//     const { teamNeedsList } = this.data.formData;
//     const filledList = []; // 已有定位
//     const missingList = []; // 缺失定位

//     teamNeedsList.forEach(item => {
//       const filledCount = item.isLeader ? 1 : 0; // 队长技能默认已满足1人
//       const missingCount = item.num - filledCount;

//       if (filledCount > 0) {
//         filledList.push({
//           ...item,
//           filledCount
//         });
//       }
//       if (missingCount > 0) {
//         missingList.push({
//           ...item,
//           missingCount
//         });
//       }
//     });

//     return { filledList, missingList };
//   },

//   addNeedNum(e) {
//     const { sid } = e.currentTarget.dataset;
//     const { teamNeedsList } = this.data.formData;
//     const newList = teamNeedsList.map(item => {
//       if (item.sid === sid) {
//         return { ...item, num: item.num + 1 };
//       }
//       return item;
//     });
//     this.setData({
//       'formData.teamNeedsList': newList
//     }, () => {
//       this.calcAutoMaxNum();
//     });
//   },

//   checkFormValid() {
//     const { formData } = this.data;
//     const isValid =
//       formData.name.trim() &&
//       formData.cid_list.length > 0 &&
//       formData.leader &&
//       formData.teamNeedsList.length > 0 &&
//       formData.condition !== undefined &&
//       this.data.autoMaxNum > 0;
//     this.setData({ formIsValid: isValid });
//     return isValid;
//   },

//   async submitTeamForm() {
//     if (!this.checkFormValid()) {
//       wx.showToast({
//         title: '请完善必填项',
//         icon: 'none'
//       });
//       return;
//     }

//     const userState = userStore.getUserInfo();
//     if (!userState.isLogin) {
//       wx.showToast({ title: '请先登录', icon: 'none' });
//       return;
//     }
//     const uid = userState.userInfo.uid;

//     const { formData } = this.data;
//     console.log('formData:',formData);
//     const autoMaxNum = this.calcAutoMaxNum();
//     const team_needs = {};
//     formData.teamNeedsList.forEach(item => {
//       team_needs[item.sid] = item.num;
//     });

//     const teamInfo = {
//       cid_list: formData.cid_list,
//       leader: uid,
//       members: {
//         [uid]: formData.leader.sid
//       },
//       condition: formData.condition,
//       name: formData.name,
//       maxNum: autoMaxNum,
//       team_needs,
//       intro: formData.intro,
//       is_matching: formData.is_matching
//     };

//     try {
//       const res_team = await teamStore.createTeam(teamInfo);
//       console.log('res_team:',res_team);
//       const newTid = res_team.data.tid;
//       const res_user= await userStore.setTid(newTid)
//       console.log('res_user:',res_user);
//       // 修复：res_user现在永远是对象，不会undefined
//       if (res_team.code !== 0 || res_user.code !== 0) {
//         throw new Error(res_user.msg || '队伍创建失败');
//       }
      
      
//       wx.showToast({
//         title: '队伍创建成功',
//         icon: 'success',
//         duration: 500
//       });

//       let targetId, type;
//       if (formData.cid_list.length > 1) {
//         targetId = tid;
//         type = 'tid';
//       } else {
//         targetId = formData.cid_list[0];
//         type = 'cid';
//       }
//       setTimeout(() => {
//         wx.navigateTo({
//           url: `/subPackages/team/team_list?targetId=${targetId}&type=${type}`
//         });
//       }, 1500);
//     } catch (error) {
//       wx.showToast({
//         title: error.message || '队伍创建失败',
//         icon: 'none'
//       });
//       console.error('创建队伍失败：', error);
//     }
//   },

//   // 移除原getCidName方法，wxml不再调用
//   onUnload() {
//     if (typeof this.unsubscribe === 'function') {
//       this.unsubscribe();
//     }
//   }
// });

// store 模块引入
const userStore = require('../../store/user.js');
const teamStore = require('../../store/teams.js');
const skillsStore = require('../../store/skills.js');
const competitionStore = require('../../store/competition.js');
const store = require('../../store/index');

Page({
  data: {
    // 表单数据
    formData: {
      name: '',
      cid_list: [],
      selectedComps: [],
      cidIndex: [],
      leader: null,
      leaderSkillIndex: 0,
      teamNeedsList: [],
      addNeedIndex: 0,
      condition: 0,
      conditionIndex: 0,
      conditionDesc: '',
      intro: '',
      is_matching: true
    },
    autoMaxNum: 0,
    cidOptions: [],
    conditionOptions: [
      { value: 0, name: '自由加入' },
      { value: 1, name: '审核加入' },
      { value: 2, name: '仅邀请加入' }
    ],
    userSkills: [],
    allSkills: [],
    formIsValid: false,
    compSearchValue: '',
    compSearchResult: [],
    showCompResult: false,
    loading: false,
    presetCid: null,

    // ========== [新增] 编辑模式相关字段 ==========
    editMode: false,      // 是否为编辑模式
    editTid: null         // 要编辑的队伍 tid
  },

  onLoad(options) {
    // 解析跳转参数：可能携带 cid（创建时预选）或 tid（编辑）
    if (options && options.cid) {
      this.data.presetCid = Number(options.cid);
    }
    // [新增] 如果携带了 tid，则进入编辑模式
    if (options && options.tid) {
      this.data.editTid = Number(options.tid);
      this.setData({ editMode: true });
    }

    // 订阅全局 store 更新（用于同步缓存变化）
    this.unsubscribe = store.subscribe(() => {
      this.syncAllCacheData();
    });
    this.initPageData();
  },

  onShow() {
    this.syncAllCacheData();
  },

  // 初始化：加载缓存数据
  async syncAllCacheData() {
    const userState = userStore.getUserInfo();
    if (!userState.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    const compList = competitionStore.getList();
    const skillArr = skillsStore.getAll();
    if (!compList.length || !skillArr.length) {
      this.setData({ loading: true });
      try {
        await Promise.all([
          competitionStore.loadCompetition(),
          skillsStore.loadSkills(),
          teamStore.loadAllTeams()
        ]);
      } catch (err) {
        wx.showToast({ title: '数据加载失败', icon: 'none' });
        console.error('缓存加载异常', err);
      } finally {
        this.setData({ loading: false });
      }
    }
    this.syncSkillsData();
    this.syncCompetitionData();
    this.setData({
      'formData.conditionDesc': this.data.conditionOptions[0].name
    }, this.checkFormValid);

    // ========== [新增] 如果为编辑模式，加载队伍数据填充表单 ==========
    if (this.data.editTid) {
      await this.loadTeamData(this.data.editTid);
    }
  },

  // [新增] 加载队伍数据并填充表单（编辑模式）
  async loadTeamData(tid) {
    // 从 store 缓存中获取队伍
    const team = teamStore.getByTid(tid);
    if (!team) {
      wx.showToast({ title: '队伍不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    // 校验当前用户是否为队长
    const userState = userStore.getUserInfo();
    const uid = userState.userInfo.uid;
    if (team.leader !== uid) {
      wx.showToast({ title: '仅队长可编辑', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    const allSkills = skillsStore.getAll();
    // 队长技能 ID（从 members 中获取）
    // 【修复】统一转成数字比较，避免数据库读出字符串 "5" 与 Number(sid) 数字 5 用 === 不相等
    const leaderSkillId = Number(team.members[team.leader]);
    const leaderSkill = allSkills.find(s => Number(s.sid) === leaderSkillId);
    const userSkills = allSkills.filter(s => userState.skills.includes(s.sid));
    const leaderSkillIndex = userSkills.findIndex(s => Number(s.sid) === leaderSkillId);

    // 构建招募需求列表（team_needs）
    const teamNeedsList = [];
    for (const [sid, num] of Object.entries(team.team_needs)) {
      const skillId = Number(sid);
      const skill = allSkills.find(s => Number(s.sid) === skillId);
      const isLeader = (skillId === leaderSkillId);
      teamNeedsList.push({
        sid: skillId,
        skillName: skill ? skill.name : '未知技能',
        num: num,
        isLeader: isLeader
      });
    }
    // 队长技能排在最前
    teamNeedsList.sort((a, b) => b.isLeader - a.isLeader);

    // 构建已选赛事列表
    const cidOptions = competitionStore.getList().map(item => ({ id: item.cid, name: item.name }));
    const selectedComps = team.cid_list.map(cid => cidOptions.find(opt => opt.id === cid)).filter(Boolean);

    // 填充表单数据（【修复】编辑模式也需加载 allSkills，否则无法添加招募需求）
    this.setData({
      allSkills,
      'formData.name': team.name,
      'formData.cid_list': team.cid_list,
      'formData.selectedComps': selectedComps,
      'formData.leader': leaderSkill || null,
      'formData.leaderSkillIndex': leaderSkillIndex >= 0 ? leaderSkillIndex : 0,
      'formData.teamNeedsList': teamNeedsList,
      'formData.condition': team.condition,
      'formData.conditionIndex': this.data.conditionOptions.findIndex(opt => opt.value === team.condition) || 0,
      'formData.conditionDesc': this.data.conditionOptions.find(opt => opt.value === team.condition)?.name || '',
      'formData.intro': team.intro || '',
      'formData.is_matching': team.is_matching || false,
    }, () => {
      this.calcAutoMaxNum();
      this.checkFormValid();
    });
  },

  initPageData() {
    this.syncAllCacheData();
  },

  // 同步技能数据（创建模式初始化）
  syncSkillsData() {
    // 若为编辑模式，数据由 loadTeamData 填充，此处不覆盖
    if (this.data.editMode) return;

    const allSkills = skillsStore.getAll();
    const userState = userStore.getUserInfo();
    const userSkills = allSkills.filter(skill => 
      userState.skills.includes(skill.sid)
    );
    
    const defaultLeader = userSkills[0] || null;
    const initNeeds = defaultLeader ? [{
      sid: defaultLeader.sid,
      skillName: defaultLeader.name,
      num: 1,
      isLeader: true
    }] : [];
  
    this.setData({
      allSkills,
      userSkills,
      'formData.leader': defaultLeader,
      'formData.teamNeedsList': initNeeds
    }, () => {
      this.calcAutoMaxNum();
      this.checkFormValid();
    });
  },

  // 同步赛事数据
  syncCompetitionData() {
    // 若为编辑模式，数据由 loadTeamData 填充，但 cidOptions 仍需要
    const competitionList = competitionStore.getList();
    const cidOptions = competitionList.map(item => ({
      id: item.cid,
      name: item.name
    }));
    this.setData({ cidOptions }, () => {
      // 处理预设 cid（创建模式）
      if (!this.data.editMode) {
        const presetCid = this.data.presetCid;
        if (presetCid) {
          const { cid_list, selectedComps } = this.data.formData;
          if (!cid_list.includes(presetCid)) {
            const compItem = cidOptions.find(item => item.id === presetCid);
            if (compItem) {
              this.setData({
                'formData.cid_list': [...cid_list, presetCid],
                'formData.selectedComps': [...selectedComps, compItem]
              });
            }
          }
          this.data.presetCid = null;
        }
      }
      this.checkFormValid();
    });
  },

  // 赛事搜索（创建/编辑通用）
  handleCompSearchInput(e) {
    const value = e.detail.value.trim();
    this.setData({ compSearchValue: value });
    if (!value) {
      this.setData({ compSearchResult: [], showCompResult: false });
      return;
    }
    const filterResult = this.data.cidOptions.filter(item => {
      const nameMatch = item.name.toLowerCase().includes(value.toLowerCase());
      const cidMatch = item.id.toString().includes(value);
      return nameMatch || cidMatch;
    });
    const { cid_list } = this.data.formData;
    const finalResult = filterResult.filter(item => !cid_list.includes(item.id));
    this.setData({ compSearchResult: finalResult, showCompResult: true });
  },

  // 选择赛事（创建/编辑通用）
  selectCompItem(e) {
    const cid = Number(e.currentTarget.dataset.cid);
    const { cid_list, selectedComps } = this.data.formData;
    if (cid_list.includes(cid)) return;

    const compItem = this.data.cidOptions.find(item => item.id === cid);
    if (!compItem) return;
    this.setData({
      'formData.cid_list': [...cid_list, cid],
      'formData.selectedComps': [...selectedComps, compItem],
      compSearchValue: '',
      compSearchResult: [],
      showCompResult: false
    }, this.checkFormValid);
  },

  // 删除已选赛事
  removeCompTag(e) {
    const cid = Number(e.currentTarget.dataset.cid);
    const { cid_list, selectedComps } = this.data.formData;
    this.setData({
      'formData.cid_list': cid_list.filter(item => item !== cid),
      'formData.selectedComps': selectedComps.filter(item => item.id !== cid)
    }, this.checkFormValid);
  },

  // 计算队伍最大人数
  calcAutoMaxNum() {
    const { teamNeedsList } = this.data.formData;
    const sum = teamNeedsList.reduce((total, item) => total + item.num, 0);
    this.setData({ autoMaxNum: sum });
    return sum;
  },

  // 表单输入通用事件
  handleInputChange(e) {
    const { key } = e.currentTarget.dataset;
    this.setData({
      [`formData.${key}`]: e.detail.value
    }, this.checkFormValid);
  },

  // 队长技能选择（创建模式可用，编辑模式下禁用）
  handleLeaderSkillChange(e) {
    // [修改] 编辑模式下禁止修改队长技能
    if (this.data.editMode) return;

    const { value } = e.detail;
    const leader = this.data.userSkills[value];
    const teamNeedsList = [...this.data.formData.teamNeedsList];
    
    const newNeeds = teamNeedsList.filter(item => !item.isLeader);
    if (leader) {
      newNeeds.unshift({
        sid: leader.sid,
        skillName: leader.name,
        num: 1,
        isLeader: true
      });
    }
  
    this.setData({
      'formData.leaderSkillIndex': value,
      'formData.leader': leader,
      'formData.teamNeedsList': newNeeds
    }, () => {
      this.calcAutoMaxNum();
      this.checkFormValid();
    });
  },

  // 入队条件选择
  handleConditionChange(e) {
    const { value } = e.detail;
    const condition = this.data.conditionOptions[value].value;
    const conditionDesc = this.data.conditionOptions[value].name;
    const patch = {
      'formData.conditionIndex': value,
      'formData.condition': condition,
      'formData.conditionDesc': conditionDesc
    };
    // 【拦截】仅主动邀请（condition===2）的队伍无法开启匹配，切换时自动关闭匹配开关
    if (condition === 2 && this.data.formData.is_matching) {
      patch['formData.is_matching'] = false;
      wx.showToast({ title: '仅主动邀请的队伍无法开启匹配，已关闭匹配', icon: 'none' });
    }
    this.setData(patch, this.checkFormValid);
  },

  // 开关事件
  handleSwitchChange(e) {
    const { key } = e.currentTarget.dataset;
    const val = e.detail.value;
    // 【拦截】仅主动邀请（condition===2）的队伍不能开启匹配
    if (key === 'is_matching' && val && this.data.formData.condition === 2) {
      wx.showToast({ title: '仅主动邀请的队伍无法开启匹配', icon: 'none' });
      // switch 点击后 UI 已自动切换，需强制回滚，否则会显示勾选但数据未变
      this.setData({ 'formData.is_matching': true }, () => {
        this.setData({ 'formData.is_matching': false });
      });
      return;
    }
    this.setData({
      [`formData.${key}`]: val
    });
  },

  // 添加招募需求
  addNeedItem(e) {
    if (this.data.editMode) {
      // 编辑模式下可正常添加，但需避免重复添加队长技能
    }
    const { value } = e.detail;
    const skill = this.data.allSkills[value];
    const { teamNeedsList } = this.data.formData;
    
    if (teamNeedsList.some(item => item.sid === skill.sid)) {
      wx.showToast({ title: '该技能已添加', icon: 'none' });
      return;
    }
  
    teamNeedsList.push({
      sid: skill.sid,
      skillName: skill.name,
      num: 1,
      isLeader: false
    });
  
    this.setData({
      'formData.teamNeedsList': teamNeedsList,
      'formData.addNeedIndex': 0
    }, () => {
      this.calcAutoMaxNum();
      this.checkFormValid();
    });
  },

  // 减少人数
  // 【修复】isLeader 分支必须同时检查 sid，否则点任意技能的"-"都会误减队长技能
  minusNeedNum(e) {
    const { sid } = e.currentTarget.dataset;
    const { teamNeedsList } = this.data.formData;
    const newList = teamNeedsList.map(item => {
      if (item.isLeader && item.sid === sid) {
        // 队长技能：最低保留1人（队长本身）
        return item.num > 1 ? { ...item, num: item.num - 1 } : item;
      }
      if (!item.isLeader && item.sid === sid && item.num > 1) {
        return { ...item, num: item.num - 1 };
      }
      return item;
    });
    this.setData({
      'formData.teamNeedsList': newList
    }, () => {
      this.calcAutoMaxNum();
    });
  },

  // 增加人数
  addNeedNum(e) {
    const { sid } = e.currentTarget.dataset;
    const { teamNeedsList } = this.data.formData;
    const newList = teamNeedsList.map(item => {
      if (item.sid === sid) {
        return { ...item, num: item.num + 1 };
      }
      return item;
    });
    this.setData({
      'formData.teamNeedsList': newList
    }, () => {
      this.calcAutoMaxNum();
    });
  },

  // 删除需求（队长技能不可删除）
  removeNeedItem(e) {
    const { sid } = e.currentTarget.dataset;
    const target = this.data.formData.teamNeedsList.find(i => i.sid === sid);
    if (target?.isLeader) {
      wx.showToast({ title: '队长技能是固定的，不能删除', icon: 'none' });
      return;
    }
    const newList = this.data.formData.teamNeedsList.filter(i => i.sid !== sid);
    this.setData({
      'formData.teamNeedsList': newList
    }, () => {
      this.calcAutoMaxNum();
      this.checkFormValid();
    });
  },

  // 校验表单
  checkFormValid() {
    const { formData } = this.data;
    const isValid =
      formData.name.trim() &&
      formData.cid_list.length > 0 &&
      formData.leader &&
      formData.teamNeedsList.length > 0 &&
      formData.condition !== undefined &&
      this.data.autoMaxNum > 0;
    this.setData({ formIsValid: isValid });
    return isValid;
  },

  // ========== [修改] 提交表单：支持创建和编辑两种模式 ==========
  async submitTeamForm() {
    if (!this.checkFormValid()) {
      wx.showToast({ title: '请完善必填项', icon: 'none' });
      return;
    }

    const userState = userStore.getUserInfo();
    if (!userState.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const uid = userState.userInfo.uid;
    const { formData, editMode, editTid } = this.data;
    const autoMaxNum = this.calcAutoMaxNum();
    const team_needs = {};
    formData.teamNeedsList.forEach(item => {
      team_needs[item.sid] = item.num;
    });

    // 【拦截】仅主动邀请（condition===2）的队伍无法开启匹配（兜底）
    if (formData.condition === 2 && formData.is_matching) {
      wx.showToast({ title: '仅主动邀请的队伍无法开启匹配', icon: 'none' });
      return;
    }

    // 构建基础数据（适用于创建和编辑）
    const baseData = {
      name: formData.name,
      cid_list: formData.cid_list,
      condition: formData.condition,
      maxNum: autoMaxNum,
      team_needs: team_needs,
      intro: formData.intro,
      is_matching: formData.is_matching
    };

    try {
      let res;
      if (editMode) {
        // ---------- 编辑模式 ----------
        res = await teamStore.updateTeam(editTid, baseData);
        if (res.code === 0) {
          // 【修复】编辑后同步匹配池：先清空该队伍旧匹配记录（幂等），勾选匹配则对全部赛事入池，取消则退出
          try {
            await wx.cloud.callFunction({
              name: 'matching_poolApi',
              data: { action: 'exitPool', params: { type: 'team', targetId: editTid } }
            });
            if (formData.is_matching) {
              for (const cid of formData.cid_list) {
                const poolRes = await wx.cloud.callFunction({
                  name: 'matching_poolApi',
                  data: { action: 'enterPool', params: { type: 'team', targetId: editTid, cid } }
                });
                if (poolRes.result.code !== 0) {
                  throw new Error(poolRes.result.msg || `赛事 ${cid} 入池失败`);
                }
              }
            }
            await teamStore.loadAllTeams();
          } catch (poolErr) {
            console.error('编辑后同步匹配池失败', poolErr);
          }
          wx.showToast({ title: '队伍更新成功', icon: 'success' });
          setTimeout(() => {
            wx.navigateTo({
              url: `/subPackages/team/team_info?tid=${editTid}`
            });
          }, 1500);
        } else {
          wx.showToast({ title: res.msg || '更新失败', icon: 'none' });
        }
      } else {
        // ---------- 创建模式 ----------
        // 【修改】拦截：已有队伍在参加所选赛事（基于用户所属队伍，个人报名 onGoing_cid 不拦截）
        const userStateNow = store.user.getUserInfo()
        const tidListNow = userStateNow.tid_list || []
        const myTeamsNow = (store.teams.getList() || []).filter(t => tidListNow.includes(t.tid))
        const boundCids = new Set((myTeamsNow || []).flatMap(t => t.cid_list || []).map(Number))
        const dupCids = (formData.cid_list || []).filter(c => boundCids.has(Number(c)))
        if (dupCids.length > 0) {
          const compList = store.competition.getList() || []
          const names = dupCids.map(c => {
            const comp = compList.find(item => Number(item.cid) === Number(c))
            return comp ? (comp.name || comp.title || '') : ''
          }).filter(Boolean)
          wx.showToast({ title: `您已有队伍在参加${names.join('、')}`, icon: 'none' })
          return
        }
        // ========== 【新增】开启匹配前置校验（移到创建前，避免"创建成功却提示冲突"的矛盾） ==========
        if (formData.is_matching) {
          // 1) 用户已有其他队伍开启匹配 → 拦截（同一用户同时仅一个队伍可开启招募）
          const matchedTeamNow = myTeamsNow.find(t => t.is_matching)
          if (matchedTeamNow) {
            wx.showToast({ title: '你已有队伍开启匹配招募', icon: 'none' })
            return
          }
          // 2) 个人匹配池是否包含队伍绑定的赛事（按赛事维度判断：跨赛事个人匹配+队伍匹配允许）
          //    同赛事下个人已在匹配池又让队伍入池 → 拦截
          try {
            const poolRes = await wx.cloud.callFunction({
              name: 'matching_poolApi',
              data: { action: 'getMyPool', params: { uid } }
            })
            const poolData = (poolRes.result && poolRes.result.code === 0 && poolRes.result.data) || []
            const myPoolCids = ((poolData[0] || {}).match_items || []).map(m => Number(m.cid))
            const conflictCids = (formData.cid_list || []).filter(c => myPoolCids.includes(Number(c)))
            if (conflictCids.length > 0) {
              const compList = store.competition.getList() || []
              const names = conflictCids.map(c => {
                const comp = compList.find(item => Number(item.cid) === Number(c))
                return comp ? (comp.name || comp.title || '') : ''
              }).filter(Boolean)
              wx.showToast({ title: `您已在个人匹配池中参加${names.join('、')}，请先取消该赛事匹配再让队伍招募`, icon: 'none' })
              return
            }
          } catch (e) {
            console.warn('查询个人匹配池失败，跳过该校验', e)
          }
        }
        const teamInfo = {
          ...baseData,
          leader: uid,
          members: { [uid]: formData.leader.sid },
        };
        res = await teamStore.createTeam(teamInfo);
        if (res.code === 0) {
          const newTid = res.data.tid;
          // 关联用户与队伍
          const resUser = await userStore.setTid(newTid);
          if (resUser.code !== 0) {
            wx.showToast({ title: '队伍创建但关联失败', icon: 'none' });
          }
          wx.showToast({ title: '队伍创建成功', icon: 'success' });

          // ========== 【新增】开启招募匹配：创建后自动入池并跳转匹配结果页 ==========
          if (formData.is_matching) {
            try {
              // 遍历所有绑定赛事入池（与 team_info.openMatch 一致）
              for (const cid of formData.cid_list) {
                const enterRes = await wx.cloud.callFunction({
                  name: 'matching_poolApi',
                  data: {
                    action: 'enterPool',
                    params: { type: 'team', targetId: newTid, cid }
                  }
                });
                if (enterRes.result.code !== 0) {
                  throw new Error(enterRes.result.msg || `赛事 ${cid} 入池失败`);
                }
              }
              // 入池成功：刷新 store 缓存
              await teamStore.loadAllTeams();
              // 跳转到队伍列表页，isMatch=true 显示 FAB + 自动弹出匹配推荐
              const firstCid = formData.cid_list[0];
              setTimeout(() => {
                wx.navigateTo({
                  url: `/subPackages/team/team_list?cid=${firstCid}&tid=${newTid}&isMatch=true`
                });
              }, 1500);
              return; // 已跳转，避免走下方未开启匹配的逻辑
            } catch (err) {
              wx.showToast({ title: err.message || '入池失败', icon: 'none' });
            }
          }

          // 未开启匹配：按赛事/队伍维度跳转（保持原逻辑）
          let targetId, type;
          if (formData.cid_list.length > 1) {
            targetId = newTid;
            type = 'tid';
          } else {
            targetId = formData.cid_list[0];
            type = 'cid';
          }
          setTimeout(() => {
            wx.navigateTo({
              url: `/subPackages/team/team_list?targetId=${targetId}&type=${type}`
            });
          }, 1500);
        } else {
          wx.showToast({ title: res.msg || '创建失败', icon: 'none' });
        }
      }
    } catch (error) {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
      console.error('操作失败：', error);
    }
  },

  onUnload() {
    if (typeof this.unsubscribe === 'function') {
      this.unsubscribe();
    }
  }
});