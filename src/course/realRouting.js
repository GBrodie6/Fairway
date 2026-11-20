// Where the holes of the two real courses lie, for the course routing (course/routing.js):
// each hole's back tee and green in meters from the clubhouse, x east and z south (north is
// -Z, as in the game's world). Read from the hole lines (golf=hole, tee to green) and the
// clubhouse buildings mapped in OpenStreetMap, data (c) OpenStreetMap contributors, available
// under the Open Database License (openstreetmap.org/copyright). Rounded to the meter.
//
// The game's holes are generated from the card yardage and a spec per hole (realCourses.js),
// so their lengths and shapes are close to these but not the same. The routing uses these
// points as the target for each hole's direction and position, then keeps the game's rules
// (corridors that do not overlap, with room between them), which the real courses do not:
// the Old Course shares fairways and greens, and Augusta National's corridors are closer.
export const REAL_ROUTING = Object.freeze({
  // Augusta National: the clubhouse (golf=clubhouse) at 33.50291 N, 82.01944 W. OSM ways
  // 854913181 (Tea Olive) to 856563268 (Holly).
  augusta: Object.freeze({
    source: 'OpenStreetMap',
    holes: Object.freeze([
      { tee: [-45, 58], green: [-378, -173] },
      { tee: [-443, -209], green: [-377, 282] },
      { tee: [-373, 340], green: [-610, 135] },
      { tee: [-569, 100], green: [-792, 116] },
      { tee: [-843, 78], green: [-742, 503] },
      { tee: [-730, 450], green: [-687, 286] },
      { tee: [-741, 220], green: [-362, 378] },
      { tee: [-271, 408], green: [-398, -90] },
      { tee: [-432, -175], green: [-112, 69] },
      { tee: [-22, 95], green: [-93, 537] },
      { tee: [42, 475], green: [-254, 853] },
      { tee: [-276, 804], green: [-346, 928] },
      { tee: [-379, 1014], green: [-568, 644] },
      { tee: [-573, 594], green: [-178, 604] },
      { tee: [-87, 589], green: [-572, 444] },
      { tee: [-587, 515], green: [-655, 368] },
      { tee: [-650, 336], green: [-253, 457] },
      { tee: [-208, 518], green: [-99, 114] },
    ].map(Object.freeze)),
  }),
  // The Old Course, St Andrews: the Royal and Ancient clubhouse (golf=clubhouse, Golf Place) at
  // 56.34353 N, 2.80243 W. OSM ways 236999244 (Burn) to 236999246 (Tom Morris).
  standrews: Object.freeze({
    source: 'OpenStreetMap',
    holes: Object.freeze([
      { tee: [-19, -4], green: [-352, -29] },
      { tee: [-338, -53], green: [-611, -297] },
      { tee: [-521, -273], green: [-699, -593] },
      { tee: [-620, -525], green: [-803, -908] },
      { tee: [-740, -883], green: [-1048, -1271] },
      { tee: [-1007, -1291], green: [-1299, -1531] },
      { tee: [-1244, -1533], green: [-1352, -1845] },
      { tee: [-1352, -1901], green: [-1227, -1782] },
      { tee: [-1247, -1862], green: [-1056, -1608] },
      { tee: [-1015, -1522], green: [-1262, -1766] },
      { tee: [-1279, -1703], green: [-1391, -1804] },
      { tee: [-1412, -1777], green: [-1347, -1502] },
      { tee: [-1403, -1500], green: [-1079, -1295] },
      { tee: [-1140, -1271], green: [-850, -901] },
      { tee: [-926, -943], green: [-725, -589] },
      { tee: [-777, -645], green: [-642, -293] },
      { tee: [-632, -260], green: [-372, 44] },
      { tee: [-373, 17], green: [-39, 44] },
    ].map(Object.freeze)),
  }),
});
