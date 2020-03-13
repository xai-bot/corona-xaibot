// See https://github.com/dialogflow/dialogflow-fulfillment-nodejs
// for Dialogflow fulfillment library docs, samples, and to report issues
'use strict';

const functions = require('firebase-functions');
const {WebhookClient} = require('dialogflow-fulfillment');
const {Card, Suggestion, Image, Payload} = require('dialogflow-fulfillment');
const { Carousel } = require('actions-on-google');
const storage_context = 'storage_context';
const all_variables = ['age', 'gender', 'country'];
const http = require('http');
const server_address = 'http://54.154.190.83:8787';


const pretty_vars = {
    'age': 'Age',
    'gender': 'Gender',
    'country': 'Country',
};

const accepted_countries = ['China'];

function get_var_name(variable) {
    if (variable === "gender_value") return 'gender';
    if (variable === "country_value") return 'country';
    return variable;
}

function get_var_key(variable) {
    if (variable === "gender") return 'gender_value';
    if (variable === "country") return 'country_value';
    return variable;
}

process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
    const agent = new WebhookClient({ request, response });
    const parameters = request.body.queryResult.parameters;
    console.log('Dialogflow Request headers: ' + JSON.stringify(request.headers));
    console.log('Dialogflow Request body: ' + JSON.stringify(request.body));

    function fallback(agent) {
        agent.add(`Sorry, I don't understand yet. But I'll learn from this conversation and improve in the future!`);
        agent.add(`Click below if you need help`);
        agent.add(new Suggestion('help'));
    }

    function expressing_dissatisfaction(agent) {
        agent.add(`I'm sorry, I try to do my best. I'll learn from this conversation and hopefully next time I'll be better!`);
        agent.add(`Click below if you need help`);
        agent.add(new Suggestion('help'));
    }

    function restart(agent) {
        agent.setContext({'name': storage_context, 'lifespan': '0'});
        agent.add(`Let's start from the beginning!`);
    }

    function end_conversation(agent) {
        agent.add('Bye :( Great talking to you! Come back later, as I will improve!');
        agent.setContext({'name': storage_context, 'lifespan': '0'});
    }

    function help_needed(agent) {
        agent.add(new Suggestion(`list all variables`));
        agent.add(new Suggestion(`describe the problem`));
        agent.add(new Suggestion(`what do you know about me?`));
    }

    function list_variables(agent) {
        all_variables.forEach(variable => agent.add(new Suggestion(variable)));
    }

    function country_mapper(country) {
        console.log(country);
        if (country in accepted_countries) {
            return country;
        }
        else {
            return 'X';
        }
    }

    function clear_variable(agent) {
        let variable = parameters.variable;
        set_var_value(agent, get_var_key(variable), 'X');
        agent.add(`Variable ${variable} was cleared`);
        agent.add(new Suggestion('passenger details'));
        agent.add(new Suggestion('survival chance'));
    }

    function format_params(age, gender, country) {
        return `age=${age}&gender=${gender}&country=${country}`;
    }

    function predict(agent, params) {
        let path = `${server_address}/predict?${params}`;
        console.log(`API path:${path}`);

        return new Promise((resolve, reject) => {
            http.get(path, (res) => {
                let body = ''; // var to store the response chunks
                res.on('data', (d) => { body += d; }); // store each response chunk
                res.on('end', () => {
                    // After all the data has been received parse the JSON for desired data
                    // Resolve the promise with the output text
                    let survival_chance = JSON.parse(body).result[0].toString();
                    let res_str = survival_message(survival_chance);
                    console.log(res_str);
                    let output = agent.add(res_str);
                    resolve(output);
                });
                res.on('error', (error) => {
                    console.log('error in API call');
                    reject();
                });
            });
        });
    }


    // specifying variable values
    function telling_geo(agent) {
        let country = parameters['geo-country'];
        let country_proccessed = country_mapper(country);
        let params = format_params(get_var_value(agent, 'age'), get_var_value(agent, 'gender_value'), country_proccessed);
        set_var_value(agent, 'country_value', country_proccessed);
        return predict(agent, params);
    }

    function telling_age(agent) {
        let age_val = parameters.number;
        let age_num = parseInt(age_val);
        if (age_num < 0) {
            agent.add(`I don't really think you are ${age_val} years old. Tell me your real age.`);
            return;
        }
        if (age_num > 122) {
            agent.add(`Well, Wikipedia says no one have ever lived that long. 
				Still, it might be interesting to see what the model does in such cases`);
        }
        let params = format_params(age_val, get_var_value(agent, 'gender_value'), get_var_value(agent, 'country_value'));
        set_var_value(agent, 'age', age_val);

        return predict(agent, params);
    }

    function telling_gender(agent) {
        let gender_val = parameters.gender;
        let params = format_params(get_var_value(agent, 'age'), gender_val, get_var_value(agent, 'country_value'));
        set_var_value(agent, 'gender_value', gender_val);

        return predict(agent, params);
    }

    function survival_message(probability) {
        let probability_percentage = probability * 100;
        return `Your chance of recovery is ${probability_percentage.toFixed(2)}%`;
    }

    function explain_feature(agent) {
        let variable = parameters.variable;
        switch(variable) {
            case 'age':
                agent.add('Age in years.');
                break;
            case 'gender':
                agent.add('Gender either "male" or "female"');
                break;
            case 'country':
                agent.add('Country. List of accepted input:');
                accepted_countries.forEach(country => agent.add(new Suggestion(country)));
                agent.add(new Suggestion('other'));
                break;
            default:
                return `I don't know the variable ${variable}`;
        }
    }

    function set_var_value(agent, variable, value) {
        let context_dict = {
            'name': storage_context,
            'lifespan': 100,
            'parameters': {
            }
        };
        context_dict.parameters[variable] = value;
        agent.setContext(context_dict);
    }

    function set_multiple_var(agent, data_dict) {
        let context_dict = {
            'name': storage_context,
            'lifespan': 100,
            'parameters': {
            }
        };
        console.log(data_dict);
        Object.keys(data_dict).forEach(variable => context_dict.parameters[variable] = data_dict[variable]);
        agent.setContext(context_dict);
    }

    function get_var_value(agent, variable) {
        let context = agent.getContext(storage_context);
        if (!context || context.parameters[variable] === null || context.parameters[variable] === undefined) {
            return 'X';
        }
        else {
            return context.parameters[variable];
        }
    }

    function current_knowledge(agent) {
        all_variables.forEach(variable => {
                let val = get_var_value(agent, get_var_key(variable));
                if (val === null || val === 'X' || val === undefined || val === "") {
                    agent.add(`${pretty_vars[variable]} is not defined`);
                }
                else {
                    agent.add(`${pretty_vars[variable]}: ${val}`);
                }
            }
        );
    }

    function welcome(agent) {
        agent.add(`Hey! I'm CoronaBot. Check out what would be your chances to survive 
				the disease after being diagnosed with COVID19.`);
        agent.add(`I'm ready to explain the reasons for your prediction!`);
    }

    function survival_prediction(agent) {
        return predict(agent, get_var_value(agent, 'age'), get_var_value(agent, 'gender'), get_var_value(agent, 'country'));
    }

    let intentMap = new Map();

    intentMap.set('Default Fallback Intent', fallback);
    intentMap.set('Default Welcome Intent', welcome);

    // dialogue management
    intentMap.set('list_variables', list_variables);
    intentMap.set('end_conversation', end_conversation);
    intentMap.set('help_needed', help_needed);
    intentMap.set('express_dissatisfaction', expressing_dissatisfaction);
    intentMap.set('restart', restart);
    intentMap.set('current_knowledge', current_knowledge);
    intentMap.set('explain_feature', explain_feature);

    // data and prediction
    intentMap.set('clear_variable', clear_variable);
    intentMap.set('survival_prediction', survival_prediction);
    intentMap.set('telling_age', telling_age);
    intentMap.set('telling_gender', telling_gender);
    intentMap.set('telling_geo', telling_geo);

    // xai

    agent.handleRequest(intentMap);
});