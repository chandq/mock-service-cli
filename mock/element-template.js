const Mock = require('mockjs');

module.exports = {
  '/mock/api/randomList': (req, res) => {
    res.json({
      code: 0,
      message: '成功',
      data: Mock.mock({
        text: Mock.Random.title(15),
        'records|20': [{ name: Mock.Random.title(1, 2), age: Mock.Random.integer(1, 100) }]
      })
    });
  },
  '/mock/api/getImage': {
    code: 0,
    message: '成功',
    data: {
      url: 'https://cdn.pixabay.com/photo/2021/01/28/21/12/wave-5959087__340.jpg'
    }
  },
  '/mock/api/randomText': (req, res) => {
    res.json({
      code: 0,
      message: '成功',
      data: {
        text: Mock.Random.title(15)
      }
    });
  }
};
