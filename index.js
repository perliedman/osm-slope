var fs = require('fs'),
    async = require('async'),
    osmium = require('osmium'),
    TileSet = require('node-hgt').TileSet,
    haversine = require('./haversine'),
    status = require('node-status'),
    console = status.console();

var argv = require('minimist')(process.argv.slice(2)),
    tileSet = new TileSet(argv.cache_dir || './data/'),
    wayinfoMap = {};

if (argv._.length < 2) {
    console.log('Missing arguments.');
    console.log('Expected arguments:');
    console.log(process.argv[0], process.argv[1], '[--cache_dir=CACHE_DIR] [OSM FILE] [DEST FILE]');
    process.exit(1);
}

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

var filter = function (way) {
    return !!way.tags('highway');
};

var countWays = function (cb) {
    var file = new osmium.File(argv._[0]),
        reader = new osmium.Reader(file, { way: true }),
        handler = new osmium.Handler(),
        count = 0;

    handler.on('way', function (way) {
        if (filter(way)) {
            count++;
            countWaysJob.inc();
        }
    });

    function next () {
        var buffer = reader.read();
        if (buffer) {
            osmium.apply(buffer, handler);
            setImmediate(next);        
        } else {
            cb(count);
        }
    }

    next();
}

var wayHandler = function(tasks, way) {
    if (filter(way)) {
        try {
            var wayId = way.id,
                coords = way.node_coordinates()
                        .map(function(c) { return { lat: c.lat, lng: c.lon }; });
        } catch (e) {
            console.warn('Error for way', way.id, ': ' + e.message);
            return;
        }
        tasks.push(function(cb) {
            processWaysJob.inc();
            async.waterfall([
                fillNodeElevations.bind(this, coords),
                createWayInfo], function(err, wayInfo) {
                    if (err) {
                        return cb(err);
                    }
                    wayinfoMap[wayId] = wayInfo;
                    cb(undefined, wayInfo);
                });
        });
    }
};

var countWaysJob = status.addItem('count'),
    processWaysJob;

status.start({
    pattern: 'Ways: {count.default.green} | ' +
        'Processed: {process.bar.cyan} {process.percentage.green} | ' +
        '{uptime.yellow} {spinner.cyan}',
    precision: 0
});

countWays(function (numberWays) {
    processWaysJob = status.addItem('process', {
        max: numberWays
    });

    var file = new osmium.File(argv._[0]),
        reader = new osmium.Reader(file, { node: true, way: true }),
        locationHandler = new osmium.LocationHandler(),
        handler = new osmium.Handler(),
        tasks = [];

    handler.on('way', wayHandler.bind(this, tasks));

    function next() {
        tasks.length = 0;
        var buffer = reader.read();

        if (buffer) {
            osmium.apply(buffer, locationHandler, handler);
            async.parallelLimit(tasks, 4, function(err) {
                if (!err) {
                    setImmediate(function () { next(); });
                } else {
                    console.error(err);
                    return process.exit(1);
                }
            });
        } else {
            fs.writeFileSync(argv._[1], JSON.stringify(wayinfoMap));
            process.exit(0);
        }
    }

    next();
});
