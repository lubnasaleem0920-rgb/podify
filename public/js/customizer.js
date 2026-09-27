// Podify product customizer — canvas preview, text/image, colors, pricing
(function () {
  const stage = document.getElementById('customizerRoot');
  if (!stage) return;

  const PRODUCT = JSON.parse(stage.dataset.product);
  const PRINTABLE = JSON.parse(stage.dataset.printable || 'null');
  const VARIANTS = JSON.parse(stage.dataset.variants || '[]');
  let currentVariantIndex = 0; // which PRODUCT COLOR is active (separate from print/text color)

  const canvasEl = document.getElementById('previewCanvas');
  const canvas = new fabric.Canvas('previewCanvas', { preserveObjectStacking: true, selection: true });
  window.__podifyCanvas = canvas; // exposed for debugging/testing purposes

  const CANVAS_SIZE = 460;
  canvas.setWidth(CANVAS_SIZE);
  canvas.setHeight(CANVAS_SIZE);

  // Default printable clip area (percentage of canvas) if product doesn't define one
  const defaultArea = { x: 0.34, y: 0.42, w: 0.32, h: 0.34 };
  const areaFront = (PRINTABLE && PRINTABLE.front) || defaultArea;
  const areaBack = (PRINTABLE && PRINTABLE.back) || defaultArea;

  let currentSide = 'front';
  const sideState = { front: null, back: null }; // fabric JSON per side
  const sideHasContent = { front: false, back: false };
  let clipRect = null;

  // picks the image for a side, using the selected color variant if any
  function imageForSide(side) {
    if (VARIANTS.length) {
      const v = VARIANTS[currentVariantIndex];
      return side === 'front' ? v.front_image : (v.back_image || v.front_image);
    }
    return side === 'front' ? PRODUCT.front_image : (PRODUCT.back_image || PRODUCT.front_image);
  }

  function areaPx(area) {
    return {
      left: area.x * CANVAS_SIZE, top: area.y * CANVAS_SIZE,
      width: area.w * CANVAS_SIZE, height: area.h * CANVAS_SIZE
    };
  }

  function drawGuide(area) {
    if (clipRect) canvas.remove(clipRect);
    const px = areaPx(area);
    clipRect = new fabric.Rect({
      left: px.left, top: px.top, width: px.width, height: px.height,
      fill: 'transparent', stroke: '#FEF8DD', strokeDashArray: [6, 4],
      selectable: false, evented: false, excludeFromExport: true
    });
    canvas.add(clipRect);
    canvas.sendToBack(clipRect);
  }

  function loadSide(side) {
    const bgUrl = imageForSide(side);
    canvas.clear();
    fabric.Image.fromURL(bgUrl, (img) => {
      const scale = Math.min(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height);
      img.set({
        left: (CANVAS_SIZE - img.width * scale) / 2,
        top: (CANVAS_SIZE - img.height * scale) / 2,
        scaleX: scale, scaleY: scale, selectable: false, evented: false, excludeFromExport: false
      });
      canvas.setBackgroundImage(img, () => {
        drawGuide(side === 'front' ? areaFront : areaBack);
        if (sideState[side]) {
          canvas.loadFromJSON(sideState[side], () => {
            canvas.renderAll();
            drawGuide(side === 'front' ? areaFront : areaBack);
            // re-attach background since loadFromJSON may not preserve custom bg call chain
            canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas), { scaleX: scale, scaleY: scale, left: img.left, top: img.top });
          });
        }
        canvas.renderAll();
      }, { crossOrigin: 'anonymous' });
    }, { crossOrigin: 'anonymous' });
  }

  // swaps only the background image for the current side, keeps all objects as-is
  function recolorCurrentSide() {
    const bgUrl = imageForSide(currentSide);
    fabric.Image.fromURL(bgUrl, (img) => {
      const scale = Math.min(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height);
      img.set({
        left: (CANVAS_SIZE - img.width * scale) / 2,
        top: (CANVAS_SIZE - img.height * scale) / 2,
        scaleX: scale, scaleY: scale
      });
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas), { crossOrigin: 'anonymous' });
    }, { crossOrigin: 'anonymous' });
  }

  function saveCurrentSide() {
    sideState[currentSide] = canvas.toJSON(['selectable']);
    sideHasContent[currentSide] = canvas.getObjects().some(o => o !== clipRect);
  }

  function switchSide(side) {
    saveCurrentSide();
    currentSide = side;
    loadSide(side);
    document.querySelectorAll('.side-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.side === side));
  }

  loadSide('front');

  // Product Color swatches
  document.querySelectorAll('.color-variant-swatch').forEach((swatch, index) => {
    swatch.addEventListener('click', () => {
      if (index === currentVariantIndex) return;
      currentVariantIndex = index;
      document.querySelectorAll('.color-variant-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      const nameEl = document.getElementById('selectedColorName');
      if (nameEl) nameEl.textContent = swatch.dataset.colorName;
      recolorCurrentSide();
    });
  });

  // Side toggle
  document.querySelectorAll('.side-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => switchSide(btn.dataset.side));
  });

  // Add text
  const textInput = document.getElementById('customText');
  const fontSelect = document.getElementById('fontSelect');
  const colorPicker = document.getElementById('textColorPicker');
  const addTextBtn = document.getElementById('addTextBtn');

  if (addTextBtn) {
    addTextBtn.addEventListener('click', () => {
      const value = (textInput.value || '').trim();
      if (!value) { textInput.focus(); return; }
      const px = areaPx(currentSide === 'front' ? areaFront : areaBack);
      const textObj = new fabric.IText(value, {
        left: px.left + px.width / 2,
        top: px.top + px.height / 2,
        originX: 'center', originY: 'center',
        fontFamily: fontSelect ? fontSelect.value : 'Poppins',
        fill: colorPicker ? colorPicker.value : '#14142B',
        fontSize: 28
      });
      canvas.add(textObj).setActiveObject(textObj);
      canvas.renderAll();
      textInput.value = '';
    });
  }

  // if a text object is selected, changing color/font restyles it directly
  function activeTextObject() {
    const active = canvas.getActiveObject();
    return (active && (active.type === 'i-text' || active.type === 'text' || active.type === 'textbox')) ? active : null;
  }
  if (colorPicker) {
    colorPicker.addEventListener('input', () => {
      const obj = activeTextObject();
      if (obj) { obj.set('fill', colorPicker.value); canvas.renderAll(); }
    });
  }
  if (fontSelect) {
    fontSelect.addEventListener('change', () => {
      const obj = activeTextObject();
      if (obj) { obj.set('fontFamily', fontSelect.value); canvas.renderAll(); }
    });
  }
  // keep pickers in sync with whichever text object is selected on canvas
  canvas.on('selection:created', syncPickersToSelection);
  canvas.on('selection:updated', syncPickersToSelection);
  function syncPickersToSelection() {
    const obj = activeTextObject();
    if (!obj) return;
    if (colorPicker && obj.fill) colorPicker.value = rgbToHex(obj.fill);
    if (fontSelect && obj.fontFamily) {
      const match = Array.from(fontSelect.options).find(o => o.value === obj.fontFamily);
      if (match) fontSelect.value = obj.fontFamily;
    }
  }
  function rgbToHex(color) {
    if (typeof color === 'string' && color.startsWith('#')) return color;
    return '#14142B';
  }

  // Add image
  const imageInput = document.getElementById('customImageInput');
  const uploadImageBtn = document.getElementById('uploadImageBtn');
  if (uploadImageBtn && imageInput) {
    uploadImageBtn.addEventListener('click', () => imageInput.click());
  }
  if (imageInput) {
    imageInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('image', file);
      const uploadBtn = document.getElementById('uploadImageBtn');
      if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Uploading...'; }
      try {
        const res = await fetch('/api/upload/custom-image', { method: 'POST', body: formData });
        if (res.status === 401) { window.location.href = '/auth/login'; return; }
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Upload failed');
        const px = areaPx(currentSide === 'front' ? areaFront : areaBack);
        fabric.Image.fromURL(data.url, (img) => {
          const scale = Math.min(px.width / img.width, px.height / img.height) * 0.9;
          img.set({
            left: px.left + px.width / 2, top: px.top + px.height / 2,
            originX: 'center', originY: 'center', scaleX: scale, scaleY: scale
          });
          canvas.add(img).setActiveObject(img);
          canvas.renderAll();
        }, { crossOrigin: 'anonymous' });
      } catch (err) {
        console.error('Image upload failed:', err);
        alert(err.message || 'Could not upload image. Please check your connection and try again.');
      } finally {
        if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.innerHTML = '<i class="bi bi-upload me-1"></i> Upload Image'; }
        imageInput.value = '';
      }
    });
  }

  // Delete / clear selected
  document.getElementById('deleteSelectedBtn')?.addEventListener('click', () => {
    const active = canvas.getActiveObject();
    if (active && active !== clipRect) { canvas.remove(active); canvas.renderAll(); }
  });
  document.getElementById('clearCanvasBtn')?.addEventListener('click', () => {
    canvas.getObjects().slice().forEach(o => { if (o !== clipRect) canvas.remove(o); });
    canvas.renderAll();
  });

  // material / size selection + live price
  // materials can be grouped in two steps (surface type, then exact material)
  // products with only one relevant group just show a flat list instead
  let selectedMaterial = null;
  let selectedSize = null;
  let backPrintEnabled = false;

  const materialGroupsDataEl = document.getElementById('materialGroupsData');
  const materialGroupsData = materialGroupsDataEl ? JSON.parse(materialGroupsDataEl.textContent) : null;

  function attachMaterialSwatchHandlers() {
    document.querySelectorAll('.material-swatch').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.material-swatch').forEach(m => m.classList.remove('active'));
        el.classList.add('active');
        selectedMaterial = el.dataset.materialId;
        recalcPrice();
      });
    });
  }

  if (materialGroupsData) {
    // STEP 1: choosing the surface/cover type reveals STEP 2's material list
    document.querySelectorAll('.group-swatch').forEach(groupEl => {
      groupEl.addEventListener('click', () => {
        document.querySelectorAll('.group-swatch').forEach(g => g.classList.remove('active'));
        groupEl.classList.add('active');

        const leafContainer = document.getElementById('materialLeafOptions');
        leafContainer.innerHTML = '';
        (materialGroupsData[groupEl.dataset.group] || []).forEach(m => {
          const col = document.createElement('div');
          col.className = 'col-4 col-md-3';
          col.innerHTML = `<div class="material-swatch" data-material-id="${m.id}">${m.name}</div>`;
          leafContainer.appendChild(col);
        });
        document.getElementById('materialLeafStep').style.display = '';
        attachMaterialSwatchHandlers();

        // auto-select the first material in this newly revealed group
        const firstLeaf = leafContainer.querySelector('.material-swatch');
        if (firstLeaf) firstLeaf.click();
      });
    });
  } else {
    attachMaterialSwatchHandlers();
  }

  const sizeSwatches = document.querySelectorAll('.size-swatch');
  const backPrintToggle = document.getElementById('backPrintToggle');
  const qtyInput = document.getElementById('quantityInput');

  sizeSwatches.forEach(el => {
    el.addEventListener('click', () => {
      sizeSwatches.forEach(s => s.classList.remove('active'));
      el.classList.add('active');
      selectedSize = el.dataset.sizeId;
      recalcPrice();
    });
  });
  if (backPrintToggle) {
    backPrintToggle.addEventListener('change', () => { backPrintEnabled = backPrintToggle.checked; recalcPrice(); });
  }
  if (qtyInput) qtyInput.addEventListener('change', recalcPrice);

  async function recalcPrice() {
    if (!selectedMaterial || !selectedSize) return;
    try {
      const res = await fetch('/api/price/calculate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: PRODUCT.id, materialId: selectedMaterial, printSizeId: selectedSize,
          hasBackPrint: backPrintEnabled, quantity: qtyInput ? qtyInput.value : 1
        })
      });
      const data = await res.json();
      if (!data.ok) return;
      const b = data.breakdown;
      document.getElementById('priceBase').textContent = 'Rs ' + b.base_price.toFixed(2);
      document.getElementById('priceSize').textContent = 'Rs ' + b.size_cost.toFixed(2);
      document.getElementById('priceMaterial').textContent = 'Rs ' + b.material_cost.toFixed(2);
      document.getElementById('priceBack').textContent = 'Rs ' + b.back_print_cost.toFixed(2);
      document.getElementById('priceUnit').textContent = 'Rs ' + b.unit_price.toFixed(2);
      document.getElementById('priceTotal').textContent = 'Rs ' + b.total.toFixed(2);
      document.getElementById('backPrintRow').style.display = b.back_print_cost > 0 ? 'flex' : 'none';
    } catch (err) { console.error(err); }
  }

  // Auto-select first option(s) so a price shows immediately on page load
  if (materialGroupsData) {
    const firstGroup = document.querySelector('.group-swatch');
    if (firstGroup) firstGroup.click(); // this cascades to auto-select the first leaf too
  } else {
    const firstFlatMaterial = document.querySelector('.material-swatch');
    if (firstFlatMaterial) firstFlatMaterial.click();
  }
  if (sizeSwatches[0]) sizeSwatches[0].click();

  // Add to cart
  const addToCartBtn = document.getElementById('addToCartBtn');
  if (addToCartBtn) {
    addToCartBtn.addEventListener('click', async () => {
      if (!selectedMaterial || !selectedSize) { alert('Please select a material and print size.'); return; }
      saveCurrentSide();

      addToCartBtn.disabled = true;
      addToCartBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Adding...';

      try {
        // Render both sides to dataURLs for preview/design-file
        const frontDataUrl = await renderSideToDataUrl('front');
        const backDataUrl = sideHasContent.back ? await renderSideToDataUrl('back') : null;

        const [frontUpload, backUpload] = await Promise.all([
          uploadPreview(frontDataUrl, 'front'),
          backDataUrl ? uploadPreview(backDataUrl, 'back') : Promise.resolve(null)
        ]);

        const res = await fetch('/api/cart/add', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: PRODUCT.id, materialId: selectedMaterial, printSizeId: selectedSize,
            variantId: VARIANTS.length ? VARIANTS[currentVariantIndex].id : null,
            hasBackPrint: backPrintEnabled, quantity: qtyInput ? qtyInput.value : 1,
            customization: { front: sideState.front, back: sideState.back },
            frontPreview: frontUpload ? frontUpload.url : null,
            backPreview: backUpload ? backUpload.url : null
          })
        });
        const data = await res.json();
        if (data.ok) {
          window.location.href = '/user/cart';
        } else if (res.status === 401) {
          window.location.href = '/auth/login';
        } else {
          alert(data.error || 'Could not add to cart');
        }
      } catch (err) {
        console.error(err);
        alert('Something went wrong. Please try again.');
      } finally {
        addToCartBtn.disabled = false;
        addToCartBtn.innerHTML = '<i class="bi bi-bag-plus me-2"></i>Add to Cart';
      }
    });
  }

  function renderSideToDataUrl(side) {
    return new Promise((resolve) => {
      const prevSide = currentSide;
      const doRender = () => {
        const px = canvas.toDataURL({ format: 'png', quality: 0.92 });
        resolve(px);
        if (prevSide !== side) loadSide(prevSide), currentSide = prevSide;
      };
      if (side === currentSide) { doRender(); }
      else {
        currentSide = side;
        loadSide(side);
        setTimeout(doRender, 250); // allow bg image to render
      }
    });
  }

  async function uploadPreview(dataUrl, side) {
    const res = await fetch('/api/upload/save-preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, side })
    });
    return res.json();
  }
})();
