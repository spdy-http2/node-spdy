!function() {
  var socket = io.connect(),
      container = $('#tweets'),
      tweets = [];

  socket.on('tweet', function(tweet) {
    if (tweets.length > 20) {
      // Remove first tweet
      tweets.shift().remove();
    }
    tweets.push(createTweet(tweet));
  });

  function createTweet(tweet) {
    var elem = $('<article class="tweet" />');

    elem.append(
      $('<img class="avatar"/>').attr({
        src: tweet.user.image,
        title: tweet.user.name,
        alt: tweet.user.name
      })
    );

    elem.append(
      $('<div class=text-container />').html(
        $('<div class=text />').html(tweet.text)
      )
    );
    elem.append('<div class=clear />');
    container.prepend(elem);

    return elem;
  };
}();
