import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'uploads/**/*', 'data/**/*', 'backups/**/*']
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
