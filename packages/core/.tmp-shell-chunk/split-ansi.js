process.stdout.write('e'); setTimeout(() => process.stdout.write('[31mRED'), 20); setTimeout(() => process.stdout.write('e[0m'), 40);
