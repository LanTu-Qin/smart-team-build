// cloudfunctions/skill_add/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { skillName } = event
  try {
    // 获取当前最大sid
    const res = await db.collection('skills').orderBy('sid', 'desc').limit(1).get()
    let maxSid = 0
    if (res.data.length > 0) {
      maxSid = res.data[0].sid
    }
    const newSid = maxSid + 1

    // 插入新技能
    await db.collection('skills').add({
      data: {
        sid: newSid,
        name: skillName
      }
    })

    return {
      success: true,
      newSid
    }
  } catch (err) {
    return {
      success: false,
      msg: err.message
    }
  }
}