const assert = require('assert');
const {
  calculateSeatUpgrade,
  getExtraStudentPrice
} = require('../src/studentSeatUpgrades');

const unitPrice = getExtraStudentPrice();
assert.strictEqual(unitPrice, Number(process.env.ASAAS_EXTRA_STUDENT_MONTHLY_PRICE || 9.70));

assert.deepStrictEqual(calculateSeatUpgrade({ currentLimit: 15, quantity: 1 }), {
  currentLimit: 15,
  quantity: 1,
  targetLimit: 16,
  unitPrice,
  amount: unitPrice
});

assert.deepStrictEqual(calculateSeatUpgrade({ currentLimit: 20, quantity: 3 }), {
  currentLimit: 20,
  quantity: 3,
  targetLimit: 23,
  unitPrice,
  amount: Math.round(unitPrice * 3 * 100) / 100
});

assert.throws(
  () => calculateSeatUpgrade({ currentLimit: 15, quantity: 0 }),
  /entre 1 e 500/
);
assert.throws(
  () => calculateSeatUpgrade({ currentLimit: 15, quantity: 501 }),
  /entre 1 e 500/
);

console.log('Student seat upgrade tests passed.');
