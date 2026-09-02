const DEFAULT_CELL_SIZE = 750;

// A minimal uniform spatial grid: fixed-size cells, each holding references to items whose bounds overlap it.
export class SpatialGrid {
  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
    this.cells = new Map(); // cellKey -> Map<opId, item>
    this.itemCellKeys = new Map(); // opId -> cellKey[] (reverse index)
  }

  _cellKey(cx, cy) {
    return `${cx},${cy}`;
  }

  _cellRange(bounds) {
    return {
      minCx: Math.floor(bounds.minX / this.cellSize),
      maxCx: Math.floor(bounds.maxX / this.cellSize),
      minCy: Math.floor(bounds.minY / this.cellSize),
      maxCy: Math.floor(bounds.maxY / this.cellSize)
    };
  }

  // Registers `item` in every cell its bounds overlap; idempotent.
  insert(item, bounds) {
    this.remove(item.opId);

    const { minCx, maxCx, minCy, maxCy } = this._cellRange(bounds);
    const keys = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this._cellKey(cx, cy);
        let cell = this.cells.get(key);
        if (!cell) {
          cell = new Map();
          this.cells.set(key, cell);
        }
        cell.set(item.opId, item);
        keys.push(key);
      }
    }
    this.itemCellKeys.set(item.opId, keys);
  }

  remove(opId) {
    const keys = this.itemCellKeys.get(opId);
    if (!keys) return;

    keys.forEach(key => {
      const cell = this.cells.get(key);
      if (cell) {
        cell.delete(opId);
        if (cell.size === 0) this.cells.delete(key);
      }
    });
    this.itemCellKeys.delete(opId);
  }

  clear() {
    this.cells.clear();
    this.itemCellKeys.clear();
  }

  // Returns every item whose cell(s) overlap `rect`, de-duplicated.
  query(rect) {
    const { minCx, maxCx, minCy, maxCy } = this._cellRange(rect);
    const results = new Map(); // opId -> item

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const cell = this.cells.get(this._cellKey(cx, cy));
        if (cell) {
          cell.forEach((item, opId) => results.set(opId, item));
        }
      }
    }

    return Array.from(results.values());
  }
}

export { DEFAULT_CELL_SIZE };
export default SpatialGrid;
