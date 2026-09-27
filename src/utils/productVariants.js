// saves the default color plus up to 3 optional extra colors for a new product
function saveProductVariants(db, productId, body, files, primaryFront, primaryBack) {
  const insertVariant = db.prepare('INSERT INTO product_variants (product_id, color_name, color_hex, front_image, back_image, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  insertVariant.run(productId, body.primary_color_name || 'Default', body.primary_color_hex || '#CCCCCC', primaryFront, primaryBack, 0);

  for (let i = 1; i <= 3; i++) {
    const name = body[`variant${i}_name`];
    const frontFile = files && files[`variant${i}_front`] ? files[`variant${i}_front`][0] : null;
    if (name && frontFile) {
      const front = `/uploads/products/${frontFile.filename}`;
      const backFile = files[`variant${i}_back`] ? files[`variant${i}_back`][0] : null;
      const back = backFile ? `/uploads/products/${backFile.filename}` : null;
      insertVariant.run(productId, name, body[`variant${i}_hex`] || '#CCCCCC', front, back, i);
    }
  }
}

// same idea, but for editing an existing product: updates the default color, appends any new ones
function syncProductVariantsOnEdit(db, productId, body, files, frontImage, backImage) {
  const primaryVariant = db.prepare('SELECT id FROM product_variants WHERE product_id = ? AND sort_order = 0').get(productId);
  if (primaryVariant) {
    db.prepare('UPDATE product_variants SET color_name=?, color_hex=?, front_image=?, back_image=? WHERE id=?')
      .run(body.primary_color_name || 'Default', body.primary_color_hex || '#CCCCCC', frontImage, backImage, primaryVariant.id);
  } else {
    db.prepare('INSERT INTO product_variants (product_id, color_name, color_hex, front_image, back_image, sort_order) VALUES (?, ?, ?, ?, ?, 0)')
      .run(productId, body.primary_color_name || 'Default', body.primary_color_hex || '#CCCCCC', frontImage, backImage);
  }

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM product_variants WHERE product_id = ?').get(productId).m;
  const insertVariant = db.prepare('INSERT INTO product_variants (product_id, color_name, color_hex, front_image, back_image, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 1; i <= 3; i++) {
    const vName = body[`variant${i}_name`];
    const frontFile = files && files[`variant${i}_front`] ? files[`variant${i}_front`][0] : null;
    if (vName && frontFile) {
      const vFront = `/uploads/products/${frontFile.filename}`;
      const backFile = files[`variant${i}_back`] ? files[`variant${i}_back`][0] : null;
      const vBack = backFile ? `/uploads/products/${backFile.filename}` : null;
      insertVariant.run(productId, vName, body[`variant${i}_hex`] || '#CCCCCC', vFront, vBack, maxOrder + i);
    }
  }
}

module.exports = { saveProductVariants, syncProductVariantsOnEdit };
