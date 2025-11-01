const Mock = require('mockjs');

module.exports = {
  '/mock/gists/db6e5d2d200192e98e6d7f14dc4c5be1/file-versions/versionned.json?limit=10': {
    success: true,
    data: [
      {
        version: '5c47c9eec3556ce4d32282e66b030edeb0a70b94',
        committed_at: '2025-10-28T02:42:49Z',
        change_status: {
          total: 2,
          additions: 1,
          deletions: 1
        }
      },
      {
        version: 'a452377ef72022525dee49ca276c52f07f571a26',
        committed_at: '2025-10-28T02:42:36Z',
        change_status: {
          total: 1,
          additions: 1,
          deletions: 0
        }
      }
    ],
    pagination: {
      cursor: null,
      hasMore: false,
      limit: 10,
      count: 2
    }
  },
  'get /mock/gists/db6e5d2d200192e98e6d7f14dc4c5be1/file-versions/versionned2.json?limit=10': {
    success: true,
    data: [
      {
        version: '5c47c9eec3556ce4d32282e66b030edeb0a70b94',
        committed_at: '2025-10-28T02:42:49Z',
        change_status: {
          total: 2,
          additions: 1,
          deletions: 1
        }
      }
    ],
    pagination: {
      cursor: null,
      hasMore: false,
      limit: 10,
      count: 1
    }
  },
  '/mock/api/randomList/:id': (req, res) => {
    console.log('req', req);
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
