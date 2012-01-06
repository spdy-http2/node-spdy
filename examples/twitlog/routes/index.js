/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index', {
    title: 'SPDY - Twitlog',
    notice: req.isSpdy ?
      'Yay! This page was requested via SPDY protocol'
      :
      'Oh, no... your browser requested this page via HTTPS'
  })
};
