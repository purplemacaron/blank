'use strict';

/**
 * Pure geometry for the desktop cursor marker: where its window sits, how it
 * glides between points, and the short label shown beside it.
 */

function markerWindowPoint(point, size) {
  const half = Math.round(Number(size) || 0) / 2;
  return { x: Math.round(point.x - half), y: Math.round(point.y - half) };
}

function clampWindowToArea(point, area, size) {
  const width = Number(size) || 0;
  const height = Number(size) || 0;
  const maxX = area.x + Math.max(0, area.width - width);
  const maxY = area.y + Math.max(0, area.height - height);
  return {
    x: Math.min(Math.max(Math.round(point.x), area.x), maxX),
    y: Math.min(Math.max(Math.round(point.y), area.y), maxY),
  };
}

function glideStep(from, to, factor = 0.35) {
  const step = Math.min(0.9, Math.max(0.05, Number(factor) || 0.35));
  const x = from.x + (to.x - from.x) * step;
  const y = from.y + (to.y - from.y) * step;
  const done = Math.abs(to.x - x) < 0.5 && Math.abs(to.y - y) < 0.5;
  return { point: done ? { x: to.x, y: to.y } : { x, y }, done };
}

function shortActor(value) {
  const text = String(value || '').trim();
  if (!text) return 'blank';
  const tail = text.split('/').filter(Boolean).pop() || text;
  const clean = tail.replace(/^custom_/i, '');
  return clean.slice(0, 18);
}

/** Stable key for one marker per actor, independent of model casing. */
function markerKey(value) {
  return String(value || '').trim().toLowerCase() || 'blank';
}

module.exports = { markerWindowPoint, clampWindowToArea, glideStep, shortActor, markerKey };
