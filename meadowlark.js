var express = require('express');
var bodyParser = require('body-parser')
var formidable = require('formidable')
var cookieParser = require('cookie-parser')
var expressSession = require('express-session')

var fortunes = require('./lib/fortune.js')
var getWeatherData = require('./lib/weather.js').getWeatherData
var credentials = require('./credentials.js')
var cartValidation = require('./lib/cartValidation.js'); 
var emailService = require('./lib/email.js')(credentials);
 
var app = express(); 

app.use(function(req, res, next){         
	res.locals.showTests = app.get('env') !== 'production' && req.query.test === '1';         
	next(); 
}); 

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended : false }))
app.use(cookieParser(credentials.cookieSecret))
app.use(expressSession({
    resave: false,
    saveUninitialized: false,
    secret: credentials.cookieSecret,
}))
app.use(express.static(__dirname + '/public'));


// 设置 handlebars 视图引擎
var handlebars = require('express3-handlebars').create({ 
		defaultLayout:'main',  
		helpers: {         
			section: function(name, options){             
				if(!this._sections) this._sections = {};             
				this._sections[name] = options.fn(this);            
				return null;         
			}     
	} 
}); 
app.engine('handlebars', handlebars.engine);
app.set('view engine', 'handlebars');

//启用视图缓存（通常开发模式下禁用）
//app.set('view cache', true);

//创建中间件给res.locals.partials添加数据
app.use(function(req, res, next){         
	if(!res.locals.partials) 
		res.locals.partials = {};         
	res.locals.partials.weather = getWeatherData();         
	next(); 
});

app.use(function(req, res, next){         
// 如果有即显消息，把它传到上下文中，然后清除它         
	res.locals.flash = req.session.flash;          
	delete req.session.flash;         
	next(); 
});

app.use(cartValidation.checkWaivers); 
app.use(cartValidation.checkGuestCounts);

//设置端口 
app.set('port', process.env.PORT || 3000); 

app.get('/', function(req, res){           
	res.render('home');
});
app.get('/about', function(req, res){         
	res.render('about', {                  
		fortune: fortunes.getFortune(),                  
		pageTestScript: '/qa/tests-about.js'           
	}); 
});
app.get('/jquerytest', function(req, res){
	res.render('jquerytest')
})

app.get('/tours/:tour', function(req, res, next){
	Product.findOne({ category: 'tour', slug: req.params.tour }, function(err, tour){
		if(err) return next(err);
		if(!tour) return next();
		res.render('tour', { tour: tour });
	});
});

app.get('/adventures/:subcat/:name', function(req, res, next){
	Product.findOne({ category: 'adventure', slug: req.params.subcat + '/' + req.params.name  }, function(err, adventure){
		if(err) return next(err);
		if(!adventure) return next();
		res.render('adventure', { adventure: adventure });
	});
});

app.get('/tours/request-group-rate', function(req, res){          
	res.render('tours/request-group-rate'); 
});
app.get('/nursery-rhyme', function(req, res){         
	res.render('nursery-rhyme');
});
app.get('/data/nursery-rhyme', function(req, res){          
	res.json({                  
		animal: 'squirrel',                  
		bodyPart: 'tail',                  
		adjective: 'bushy',                  
		noun: 'heck',          
	}); 
});
app.get('/thank-you', function(req, res){
	res.render('thank-you');
});
app.get('/newsletter', function(req, res){
	res.render('newsletter');
});

// for now, we're mocking NewsletterSignup:
function NewsletterSignup(){
}
NewsletterSignup.prototype.save = function(cb){
	cb();
};

// mocking product database
function Product(){
}
Product.find = function(conditions, fields, options, cb){
	if(typeof conditions==='function') {
		cb = conditions;
		conditions = {};
		fields = null;
		options = {};
	} else if(typeof fields==='function') {
		cb = fields;
		fields = null;
		options = {};
	} else if(typeof options==='function') {
		cb = options;
		options = {};
	}
	var products = [
		{
			name: 'Hood River Tour',
			slug: 'hood-river',
			category: 'tour',
			maximumGuests: 15,
			sku: 723,
		},
		{
			name: 'Oregon Coast Tour',
			slug: 'oregon-coast',
			category: 'tour',
			maximumGuests: 10,
			sku: 446,
		},
		{
			name: 'Rock Climbing in Bend',
			slug: 'rock-climbing/bend',
			category: 'adventure',
			requiresWaiver: true,
			maximumGuests: 4,
			sku: 944,
		}
	];
	cb(null, products.filter(function(p) {
		if(conditions.category && p.category!==conditions.category) return false;
		if(conditions.slug && p.slug!==conditions.slug) return false;
		if(isFinite(conditions.sku) && p.sku!==Number(conditions.sku)) return false;
		return true;
	}));
};
Product.findOne = function(conditions, fields, options, cb){
	if(typeof conditions==='function') {
		cb = conditions;
		conditions = {};
		fields = null;
		options = {};
	} else if(typeof fields==='function') {
		cb = fields;
		fields = null;
		options = {};
	} else if(typeof options==='function') {
		cb = options;
		options = {};
	}
	Product.find(conditions, fields, options, function(err, products){
		cb(err, products && products.length ? products[0] : null);
	});
};

var VALID_EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

app.post('/newsletter', function(req, res){
	var name = req.body.name || '', email = req.body.email || '';
	// input validation
	if(!email.match(VALID_EMAIL_REGEX)) {
		if(req.xhr) return res.json({ error: 'Invalid name email address.' });
		req.session.flash = {
			type: 'danger',
			intro: 'Validation error!',
			message: 'The email address you entered was not valid.',
		};
		return res.redirect(303, '/newsletter/archive');
	}
	new NewsletterSignup({ name: name, email: email }).save(function(err){
		if(err) {
			if(req.xhr) return res.json({ error: 'Database error.' });
			req.session.flash = {
				type: 'danger',
				intro: 'Database error!',
				message: 'There was a database error; please try again later.',
			};
			return res.redirect(303, '/newsletter/archive');
		}
		if(req.xhr) return res.json({ success: true });
		req.session.flash = {
			type: 'success',
			intro: 'Thank you!',
			message: 'You have now been signed up for the newsletter.',
		};
		return res.redirect(303, '/newsletter/archive');
	});
});

app.get('/newsletter/archive', function(req, res){
	res.render('newsletter/archive');
});

app.post('/process', function(req, res){     
	if(req.xhr || req.accepts('json,html')==='json'){         
	// 如果发生错误，应该发送 { error: 'error description' }         
		res.send({ success: true });     
	} 
	else {         
	// 如果发生错误，应该重定向到错误页面         
		res.redirect(303, '/thank-you');     
	} 
});

app.get('/contest/vacation-photo',function(req,res){     
	var now = new Date();     
	res.render('contest/vacation-photo',
		{year: now.getFullYear(),month: now.getMonth()}); 
}); 
 
app.post('/contest/vacation-photo/:year/:month', function(req, res){     
	var form = new formidable.IncomingForm();     
	form.parse(req, function(err, fields, files){         
		if(err) 
			return res.redirect(303, '/error');         
		console.log('received fields:');         
		console.log(fields);         
		console.log('received files:');         
		console.log(files);         
		res.redirect(303, '/thank-you');     
	}); 
});

app.get('/cart', function(req, res, next){
	var cart = req.session.cart;
	if(!cart) next();
	res.render('cart', { cart: cart });
});

app.post('/cart/add', function(req, res, next){
	var cart = req.session.cart || (req.session.cart = { items: [] });
	Product.findOne({ sku: req.body.sku }, function(err, product){
		if(err) return next(err);
		if(!product) return next(new Error('Unknown product SKU: ' + req.body.sku));
		cart.items.push({
			product: product,
			guests: req.body.guests || 0,
		});
		res.redirect(303, '/cart');
	});
});

app.get('/cart/checkout', function(req, res, next){
	var cart = req.session.cart;
	if(!cart) next();
	res.render('cart-checkout');
});
app.get('/cart/thank-you', function(req, res){
	res.render('cart-thank-you', { cart: req.session.cart });
});
app.get('/email/cart/thank-you', function(req, res){
	res.render('email/cart-thank-you', { cart: req.session.cart, layout: null });
});
app.post('/cart/checkout', function(req, res, next){
	var cart = req.session.cart;
	if(!cart) next(new Error('Cart does not exist.'));
	var name = req.body.name || '', email = req.body.email || '';
	// input validation
	if(!email.match(VALID_EMAIL_REGEX)) return next(new Error('Invalid email address.'));
	// assign a random cart ID; normally we would use a database ID here
	cart.number = Math.random().toString().replace(/^0\.0*/, '');
	cart.billing = {
		name: name,
		email: email,
	};
    res.render('email/cart-thank-you', 
    	{ layout: null, cart: cart }, function(err,html){
	        if( err ) console.log('error in email template');
	        // emailService.send(cart.billing.email,
	        // 	'Thank you for booking your trip with Meadowlark Travel!',
	        // 	html);
	    }
    );
    res.render('cart-thank-you', { cart: cart });
});

// 定制 404 页面
app.use(function(req, res){
    res.status(404);
    res.render('404')
}); 
 
// 定制 500 页面
 app.use(function(err, req, res, next){
    console.error(err.stack);             
    res.status(500);         
    res.render('500'); 
}); 
 
app.listen(app.get('port'), function(){   
	console.log('Express started on http://localhost:' + app.get('port') + ';press Ctrl-C to terminate.');
});