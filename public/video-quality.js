function videoQuality(width, height) {
 const longEdge = Math.max(width || 0, height || 0);
 const shortEdge = Math.min(width || 0, height || 0);
 if ((longEdge === 3840 || longEdge === 4096) && shortEdge >= 1600 && shortEdge <= 2160) return '4K';
 return height ? height + 'p' : 'BẢN GỐC';
}
