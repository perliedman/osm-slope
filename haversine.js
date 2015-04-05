// haversine
// By Nick Justice (niix)
// https://github.com/niix/haversine
//
// Released under MIT License.
//
// Slightly modified by Per Liedman.

var haversine = (function() {
    // convert to radians
    var toRad = function(num) {
        return num * Math.PI / 180;
    };

    return function haversine(start, end) {
        var R = 6371;
        var dLat = toRad(end.lat - start.lat);
        var dLon = toRad(end.lng - start.lng);
        var lat1 = toRad(start.lat);
        var lat2 = toRad(end.lat);

        var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    };
})();

module.exports = haversine;
