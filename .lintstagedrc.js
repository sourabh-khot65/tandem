export default {
  '*.{ts,js}': ['prettier --write'],
  '*.ts': () => 'tsc --noEmit',
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
