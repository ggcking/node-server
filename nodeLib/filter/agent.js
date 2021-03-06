"use strict";
var http = require('http'),
    https = require('https'),
    url = require('url'),
    fs = require('fs');
var cookies = {};

function doRequest(request, response, option, path, fws){
  var location = url.parse(path),
      headers = {   //拼接headers数据，只处理必要的
          "user-agent": request.headers["user-agent"],
          "content-type": request.headers["content-type"] || "text/html",
          cookie: option.cookie || cookies[option.host] || "",   //很多站点都是通过cookie进行SSO认证,可以自己在浏览器模拟
          host: option.host || request.util.host,
          accept: request.headers.accept || "*"
      };
      if( request.method === "POST" ){
          headers["content-length"] = request.headers["content-length"];
      }
      var param = {    // 处理转发参数
          host: option.host || request.util.host,
          port: option.port || 80,
          path: option.path ? option.path(location) : location.path,
        method: request.method,
       headers: headers
      };
  return ( option.port === 443 ? https : http ).request(param,function(res){
        var ck = res.headers["set-cookie"],
            hck = cookies[option.host];
        if(ck){ // 远程cookie同步
          [].slice.call(ck).forEach(function(item){
            var m = item.split(";")[0],
                key = m.split("=")[0],
                reg = new RegExp('\\b' + key + '=[^;]*');
            if( reg.test(hck) ){
              hck = hck.replace(reg,m);
            }else{
              hck += ";" + m;
            }
          });
          cookies[option.host] = hck;
        }
        if( res.statusCode === 302 ){ // 对于远程服务的302转发中的域名部分修改成本地域名
          res.headers.location = res.headers.location.replace( /(https?:\/\/)[^\\\/]+/, "http://" + request.headers.host );
        }
        response.writeHead(res.statusCode, res.headers);
        res.pipe(response);
        if(fws){
          res.on('data',function(chunk){
            fws.write(chunk);
          }).on('end',function(){
            fws.end();
          });
        }
    }).on('error',function(err){
        response.writeHead(408, {"Content-Type": "text/html"});
        response.end( JSON.stringify({
            code: 408,
            param: param,
            info: 'timeout or no-response',
            err: err
        }, null, 4) );
    });
}

function execOpt (opt) {
  if( opt.origin && !opt.host ){
    var loc = url.parse( opt.origin );
    opt.host = loc.hostname;
    opt.port = loc.protocol === "https:" ? 443 : loc.port;
  }
}

var mkdirs = function(dirpath, mode, callback) {
  fs.exists(dirpath, function(exists) {
    if(exists) {
      callback();
    } else {
      //尝试创建父目录，然后再创建当前目录
      mkdirs(require('path').dirname(dirpath), mode, function(){
        fs.mkdirSync(dirpath, mode);
        callback();
      });
    }
  });
};

exports.execute = function(request, response, option, path){
  //配置解析: 支持通过 origin = http://xuan.news.cn/ 代替host和port配置，
  //并解析协议为https:时，port自动设置为443.
  execOpt(option);

  var fws = null;
  if( option.save === true ){
    var root = request.util.conf.root,
        dir = root + path.replace( /^(.*?)[^\\\/]+$/, "$1"),
        filename = root + path;

    if( fs.existsSync(dir) ){
      fws = fs.createWriteStream( filename.replace(/[?]+.*$/,"") );
    }else{
      try{
        mkdirs(dir,{},function(){
          //fws = fs.createWriteStream( filename.replace(/[?]+.*$/,"") );
        });
      }catch(e){}
    }
  }

  var req = doRequest(request, response, option, path, fws);
  request.on('data', function(chunk) {
      req.write( chunk );  //提交POST数据
  }).on('end', function() {
      req.end();
  });
};
