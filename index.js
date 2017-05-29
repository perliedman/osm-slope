var fs = require('fs'),
    async = require('async'),
    osmium = require('osmium'),
    TileSet = require('node-hgt').TileSet,
    haversine = require('./haversine'),
    argv = require('minimist')(process.argv.slice(2)),
    tileSet = new TileSet(argv.cache_dir || './data/'),
    file = new osmium.File(argv._[0]),
    reader = new osmium.Reader(file, { node: true, way: true }),
    locationHandler = new osmium.LocationHandler(),
    handler = new osmium.Handler(),
    wayinfoMap = {},
    completed = 0,
    tasks;

var fillNodeElevations = function (coords, cb) {
    var wait = coords.length;

    coords.forEach(function(c) {
        tileSet.getElevation(c, function(err, elevation) {
            if (!err) {
                c.elevation = elevation;
                wait--;
            } else {
                cb(err);
                return;
            }

            if (wait === 0) {
                cb(null, coords);
            }
        });
    });
};

var createWayInfo = function (coords, cb) {
    var wayInfo = coords.reduce(function(a, c) {
        var data = a.data,
            d;

        if (a.lastCoord) {
            d = haversine(a.lastCoord, c);
            if (c.elevation > a.lastElevation) {
                data.climb += c.elevation - a.lastElevation;
                data.climbDistance += d;
            } else {
                data.descent += a.lastElevation - c.elevation;
                data.descentDistance += d;
            }

            data.distance += d;
        }

        a.lastElevation = c.elevation;
        a.lastCoord = c;

        return a;
    }, {
        data: {
            distance: 0,
            climbDistance: 0,
            descentDistance: 0,
            climb: 0,
            descent: 0
        }
    }).data;
    cb(null, wayInfo);
};

handler.on('way', function(way) {
    if (way.tags('highway')) {
        try {
            var wayId = way.id,
                coords = way.node_coordinates()
                        .map(function(c) { return { lat: c.lat, lng: c.lon }; });
        } catch (e) {
            console.warn(e);
            return;
        }
        tasks.push(function(cb) {
            async.waterfall([
                fillNodeElevations.bind(this, coords),
                createWayInfo], function(err, wayInfo) {
                    if (err) {
                        return cb(err);
                    }
                    console.log(wayId);
                    wayinfoMap[wayId] = wayInfo;
                    cb(undefined, wayInfo);
                });
        });
    }
});

tasks = [];
function nextRead(cb) {
    var buffer = reader.read();

    if (buffer) {
        osmium.apply(buffer, locationHandler, handler);
        setImmediate(function () { nextRead(cb); });
    } else {
        cb();
    }
}


nextRead(function () {
    console.log('Read', tasks.length, ' ways');
    async.parallelLimit(tasks, 4, function(err) {
        if (!err) {
            fs.writeFileSync(argv._[1], JSON.stringify(wayinfoMap));
        } else {
            console.error(err);
        }
    });
});


