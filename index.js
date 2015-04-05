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

handler.on('way', function(way) {
    if (way.tags('highway')) {
        var wayId = way.id,
            coords = way.node_coordinates()
                    .map(function(c) { return { lat: c.lat, lng: c.lon }; });
        tasks.push(function(cb) {
            var lastCoord,
                lastElevation,
                wait,
                createWayInfo = function() {
                    var wayInfo = coords.reduce(function(a, c) {
                        var d;

                        if (lastCoord) {
                            d = haversine(lastCoord, c);
                            if (c.elevation > lastElevation) {
                                a.climb += c.elevation - lastElevation;
                                a.climbDistance += d;
                            } else {
                                a.descent += lastElevation - c.elevation;
                                a.descentDistance += d;
                            }

                            a.distance += d;
                        }

                        lastElevation = c.elevation;
                        lastCoord = c;

                        return a;
                    }, {
                        distance: 0,
                        climbDistance: 0,
                        descentDistance: 0,
                        climb: 0,
                        descent: 0
                    });

                    wayinfoMap[wayId] = wayInfo;
                    setImmediate(function() {
                        cb(undefined, wayInfo);
                    });
                };

            wait = coords.length;

            coords.forEach(function(c) {
                tileSet.getElevation(c, function(err, elevation) {
                    if (!err) {
                        c.elevation = elevation;
                        wait--;
                    } else {
                        console.log(err);
                        cb(err);
                        return;
                    }

                    if (wait === 0) {
                        createWayInfo();
                    }
                });
            });
        });
    }
});

function next() {
    var buffer = reader.read();
    tasks = [];

    if (buffer) {
        osmium.apply(buffer, locationHandler, handler);
        async.series(tasks, function(err) {
            if (!err) {
                completed += tasks.length;
                if (tasks.length) {
                    console.log(completed);
                }
                setImmediate(function() {
                    next();
                });
            } else {
                console.log(err);
            }
        });
    } else {
        fs.writeFileSync(argv._[1], JSON.stringify(wayinfoMap));
    }
}

next();
