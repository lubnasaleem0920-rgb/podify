const db = require('../models/db');

// price = base + (size area * size rate) + (size area * material rate) [+ same again if back print]
function calculatePrice({ productId, materialId, printSizeId, hasBackPrint = false, quantity = 1 }) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Product not found');

  let breakdown = {
    base_price: product.base_price,
    material_name: null,
    material_cost: 0,
    size_label: null,
    size_cost: 0,
    back_print_cost: 0,
    unit_price: 0,
    quantity: Math.max(1, parseInt(quantity) || 1),
    total: 0
  };

  let area = 0;
  let sizePricePerSqIn = 0;

  if (printSizeId) {
    const size = db.prepare('SELECT * FROM print_sizes WHERE id = ?').get(printSizeId);
    if (size) {
      area = size.width_in * size.height_in;
      sizePricePerSqIn = size.price_per_sq_inch;
      breakdown.size_label = size.label;
      breakdown.size_cost = round2(area * sizePricePerSqIn);
    }
  }

  if (materialId) {
    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
    if (material) {
      breakdown.material_name = material.name;
      breakdown.material_cost = round2(area * material.price_per_unit);
    }
  }

  if (hasBackPrint && product.supports_back_print) {
    breakdown.back_print_cost = round2(breakdown.size_cost + breakdown.material_cost);
  }

  breakdown.unit_price = round2(
    breakdown.base_price + breakdown.size_cost + breakdown.material_cost + breakdown.back_print_cost
  );
  breakdown.total = round2(breakdown.unit_price * breakdown.quantity);

  return breakdown;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = { calculatePrice, round2 };
