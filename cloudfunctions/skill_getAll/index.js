// cloudfunctions/skill_getAll/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  try {
    const res = await db.collection('skills').get()
    console.log(res.data);
    return {
      success: true,
      list: res.data
    }
  } catch (err) {
    return {
      success: false,
      msg: err.message
    }
  }
}