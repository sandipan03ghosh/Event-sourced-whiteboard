import React from 'react';
function Toolbar() {
  return (
    <div>
      <label>Color: </label>
      <select id="color">
        <option value="black">Black</option>
        <option value="red">Red</option>
        <option value="blue">Blue</option>
        <option value="green">Green</option>
      </select>
      <label> Width: </label>
      <input type="range" id="width" min="1" max="10" defaultValue="2" />
      <button onClick={() => window.dispatchEvent(new Event('clearCanvas'))}>Clear</button>
    </div>
  );
}

export default Toolbar;
