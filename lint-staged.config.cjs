module.exports = {
  '**/*.{ts,tsx,js,jsx,json,md}': [
    'prettier --write',
    'eslint --fix',
  ],
};
