var restify = require('restify');
var builder = require('botbuilder');
var FatSecret = require('fatsecret');
var fatAPI = new FatSecret('4e53e1b2bc9f4415ab58eb6ef60b5890', 'a3a2d704f43541e7be1867b64a63d0a3');
var requestpr = require('request-promise').defaults({ encoding: null });
var request = require('request');
// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

// Define memory storage space
var inMemoryStorage = new builder.MemoryBotStorage();

var bot = new builder.UniversalBot(connector, [
    function (session) {
        session.beginDialog('greetings', session.userData.profile);
    },
    function (session, results) {
        session.userData.profile = results.response
        session.send(`Hello ${session.userData.profile.name}!`);
        session.beginDialog('help');
    }
]).set('storage', inMemoryStorage); // Register in-memory storage 

bot.dialog('greetings', [
    function (session, args, next, results) {
        session.userData.profile = args || {}; // Set the profile or create the object.
        session.userData.profile.allergies = [];
        if (!session.userData.profile.name) {
            session.beginDialog('askName');
        } else {
            next();
        }
    },
    function (session, results) {
        session.endDialogWithResult(results);
    }
]);

bot.dialog('askName', [
    function (session) {
        builder.Prompts.text(session, "Hi! I'm Health Bot. What is your name?");
    },
    function (session, results) {
        session.userData.profile.name = results.response;
        session.endDialogWithResult({ response: session.userData.profile });
    }
]);

bot.dialog('help', [
    function(session) {
        builder.Prompts.choice(session, "How would you like me to help you?", "Review food|Find recipe", { listStyle: 3 });
    },
    function(session, results) {
        if (results.response.entity.indexOf('Find recipe') >= 0) {
            session.beginDialog('reviewRecipe');
        } else if (results.response.entity.indexOf('Review food') >= 0) {
            session.beginDialog('review');
        }
    }
])
.triggerAction({
    matches: /^help$/i,
});






bot.dialog('review',[
    function (session) {
        builder.Prompts.choice(session, "OK then! Tell me what you are about to eat.", "Upload picture|Type it out", { listStyle: 3 });
    },
    function(session, results) {
        if (results.response.entity.indexOf('Upload picture') >= 0) {
            session.beginDialog('getFoodByPic');
        } else if (results.response.entity.indexOf('Type it out') >= 0) {
            session.beginDialog('getFoodByText');
        }
    }
]);

bot.dialog('getFoodDetails', [
    function(session) {
        fatAPI
            .method('foods.search', {
                search_expression: session.conversationData.foodItem,
                max_results: 3
            })
            .then(function(food_results) {
                session.dialogData.foodList = food_results.foods.food;
                var options = '';
                if(food_results.foods.total_results == 0) {
                    session.endDialog(`Sorry, I have no data on '${session.conversationData.foodItem}'`);
                } else {
                    options += food_results.foods.food[0].food_name;
                    for(var i = 1; i < food_results.foods.food.length && i < 3; i++)
                        options += '|' + food_results.foods.food[i].food_name;
                    builder.Prompts.choice(session, "Choose any from these", options, { listStyle: 3 });
                }
            })
            .catch(err => console.error(err));
    },
    function(session, results) {
        session.dialogData.food = session.dialogData.foodList[results.response.index];
        session.send('Here\'s some info');
        session.send(`${ session.dialogData.food.food_name }<br />${ session.dialogData.food.food_description }`);
        builder.Prompts.confirm(session, `Want more info on ${session.dialogData.food.food_name}?`);
    },
    function(session, results) {
        if(results.response) {
            fatAPI
                .method('food.get', {
                    food_id: session.dialogData.food.food_id
                })
                .then(function(food_results) {
                    var details = food_results.food;
                    session.send(`
${ details.food_name }<br />
Calcium: ${ details.servings.serving.calcium }<br />
Calories: ${ details.servings.serving.caloriess }<br />
Carbohydrate: ${ details.servings.serving.carbohydrate }<br />
Cholestrol: ${ details.servings.serving.cholesterol }<br />
Fat: ${ details.servings.serving.fat }<br />
Fiber: ${ details.servings.serving.fiber }<br />
Iron: ${ details.servings.serving.iron }<br />
Protein: ${ details.servings.serving.protein }<br />
Saturated Fat: ${ details.servings.serving.saturated_fat }<br />
                        `)
                    session.endDialog("Call me out whenever you need me by my just saying 'help' and I'll be there for you! :)");
                })
                .catch(err => console.error(err));
        }
    }
]);

bot.dialog('getFoodByPic',[
    function (session) {
        builder.Prompts.attachment(session, "Please click and upload a picture.");
    },
    function(session, results) {
        
        var msg = session.message;
        if (msg.attachments && msg.attachments.length > 0) {
            // Echo back attachment
            var attachment = msg.attachments[0];
            var fileDownload = requestpr(attachment.contentUrl);

            fileDownload.then(function (response) {
                // Send reply with attachment type & size
                var base64Image = new Buffer(response, 'binary').toString('base64');

                fetchInfo(base64Image, function(err, data) {
                    if(err) {

                    } else {
                        var data = JSON.parse(data);
                        session.conversationData.foodItem = data.responses[0].labelAnnotations[0].description;
                        session.beginDialog('getFoodDetails', session.conversationData.foodItem);
                    }
                });

            }).catch(function (err) {
                console.log('Error downloading attachment:', { statusCode: err.statusCode, message: err.response.statusMessage });
            });

        }

    }
])
.triggerAction({
    matches: /^Upload picture$/i,
});

function fetchInfo(image, done) {
    const body = {
      "requests":[
        {
          "image":{
                "content": image
            },
          "features":[
            {
              "type": "LABEL_DETECTION"
            }
          ]
        }
      ]
    };
    request.post({
        uri: 'https://vision.googleapis.com/v1/images:annotate?key=AIzaSyCHOTdispXasYJoSwAVKcg0VhDYyMQnWds',
        method: 'post',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    },
    function(err, res, body) {
        if(err) done(err, null);
        else done(null, body);
    });
}

bot.dialog('getFoodByText',[
    function (session) {
        builder.Prompts.text(session, "Please type out what you are about to eat.");
    },
    function(session, results) {
        session.conversationData.foodItem = results.response;
        session.beginDialog('getFoodDetails', session.conversationData.foodItem);
    }
])
.triggerAction({
    matches: /^Type it out$/i,
});









bot.dialog('reviewRecipe',[
    function (session) {
        builder.Prompts.choice(session, "OK then! How would you like to get your recipe.", "Upload picture|Type it out", { listStyle: 3 });
    },
    function(session, results) {
        if (results.response.entity.indexOf('Upload picture') >= 0) {
            session.beginDialog('getRecipeByPic');
        } else if (results.response.entity.indexOf('Type it out') >= 0) {
            session.beginDialog('getRecipeByText');
        }
    }
]);

bot.dialog('getRecipeByPic',[
    function (session) {
        builder.Prompts.attachment(session, "Please click and upload a picture.");
    },
    function(session, results) {
        
        var msg = session.message;
        if (msg.attachments && msg.attachments.length > 0) {
            var attachment = msg.attachments[0];
            var fileDownload = requestpr(attachment.contentUrl);

            fileDownload.then(function (response) {
                var base64Image = new Buffer(response, 'binary').toString('base64');

                fetchInfo(base64Image, function(err, data) {
                    if(err) {

                    } else {
                        var data = JSON.parse(data);
                        session.conversationData.recipeItem = data.responses[0].labelAnnotations[0].description;
                        session.beginDialog('getRecipe', session.conversationData.recipeItem);
                    }
                });

            }).catch(function (err) {
                console.log('Error downloading attachment:', { statusCode: err.statusCode, message: err.response.statusMessage });
            });

        }

    }

]);


bot.dialog('getRecipeByText',[
    function (session) {
        builder.Prompts.choice(session, "What is that you would like to get a recipe of?");
    },
    function(session, results) {
        session.conversationData.recipeItem = results.response;
        session.beginDialog('getRecipe', session.conversationData.recipeItem);
    }
]);



bot.dialog('getRecipe', [
    function(session) {
        fatAPI
            .method('recipes.search', {
                search_expression: session.conversationData.recipeItem,
                max_results: 3
            })
            .then(function(recipe_results) {
                session.dialogData.recipeList = recipe_results.recipes.recipe;
                var options = '';
                if(recipe_results.recipes.total_results == 0) {
                    session.endDialog(`Sorry, I have no data on '${session.conversationData.recipeItem}'`);
                } else {
                    options += recipe_results.recipes.recipe[0].recipe_name;
                    for(var i = 1; i < recipe_results.recipes.recipe.length && i < 3; i++)
                        options += '|' + recipe_results.recipes.recipe[i].recipe_name;
                    builder.Prompts.choice(session, "Choose any from these", options, { listStyle: 3 });
                }
            })
            .catch(err => console.error(err));
    },
    function(session, results) {
        session.dialogData.recipe = session.dialogData.recipeList[results.response.index];
        session.send('Here\'s the recipe');
            fatAPI
                .method('recipe.get', {
                    recipe_id: session.dialogData.recipe.recipe_id
                })
                .then(function(recipe_results) {
                    var details = recipe_results.recipe;
                    session.send(`
${details.recipe_name}<br />
Preparation Time (mins): ${details.preparation_time_min}<br />
Number of Servings: ${details.number_of_servings}<br /><br />
${details.recipe_description}
                    `);
                    if(details.hasOwnProperty('recipe_images'))
                        session.send({
                            attachments: [
                                {
                                    contentType: 'image/jpeg',
                                    contentUrl: details.recipe_images.recipe_image[0],
                                    name: 'Recipe'
                                }
                            ]
                        });
                    var ingredients = 'Ingredients<br />';
                    for(var i = 0; i < details.ingredients.ingredient.length; i++) {
                        ingredients += details.ingredients.ingredient[i].ingredient_description + '<br />'
                    }
                    session.send(ingredients);

                    var directions = 'Directions<br /><br />';
                    for(var i = 0; i < details.directions.direction.length; i++) {
                        directions += details.directions.direction[i].direction_description + '<br /><br />'
                    }
                    session.send(directions);
                    session.endDialog("Call me out whenever you need me by my just saying 'help' and I'll be there for you! :)");
                })
                .catch(err => console.error(err));

    }
]);