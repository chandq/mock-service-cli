/**
 * lint-staged config
 * @ref https://www.npmjs.com/package/lint-staged
 * @desc 由 @isyscore/cli@1.25.0 于 2021-05-24 10:35:28 自动生成
 */

module.exports = {
  '*.[tj]s': ['eslint --fix'],

  '*.vue': ['eslint --fix', 'stylelint --fix'],

  '*.s?css': ['stylelint --fix'],

  '*.json': ['prettier --write']
};
