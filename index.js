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
        if (accepted_countries.includes(country)) {
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
        console.log(`country_processed: ${country_proccessed}`);
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
        return `Your death risk is ${probability_percentage.toFixed(2)}%`;
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
        agent.add(`Hey! I'm CoronaBot. Check out what would be your death risk 
				after being diagnosed with COVID19.`);
        agent.add(`I'm ready to explain the reasons for your prediction!`);
    }

    function survival_prediction(agent) {
        return predict(agent, get_var_value(agent, 'age'), get_var_value(agent, 'gender'), get_var_value(agent, 'country'));
    }

    function formatted_parameters() {
        let params_str = ``;
        let params_dict = new Map();
        all_variables.forEach(variable => params_dict[get_var_key(variable)] = get_var_value(agent, get_var_key(variable)));

        for (var key in params_dict) {
            params_str += get_var_name(key) + `=` + params_dict[key] + `&`;
        }
        console.log(params_str);
        return params_str;
    }

    function break_down(agent) {
        let params = formatted_parameters();
        let imageUrl = `${server_address}/break_down?${params}`;
        console.log(imageUrl);

        agent.add(`Creating a plot. It may take a few seconds...`);
        agent.add(new Card({
                title: `Break down plot`,
                imageUrl: imageUrl,
                text: `This chart illustrates the contribution of variables to the final prediction`,
                buttonText: `See larger plot`,
                buttonUrl: imageUrl
            })
        );

    }

    function ceteris_paribus(agent) {
        let variable = parameters.variable;
        let country = parameters['geo-country'];
        let gender = parameters.gender;
        if (variable && variable.length > 0) {
            variable = variable[0];
        }
        else if (country && country.length > 0) {
            variable = 'country';
        }
        else if (gender && gender.length > 0) {
            variable = 'gender';
        }
        else
        {
            variable = 'age';
        }

        let params = formatted_parameters();
        let imageUrl = `${server_address}/ceteris_paribus?${params}variable=${variable}`;
        console.log(imageUrl);

        agent.add(`Creating a plot. It may take a few seconds...`);
        agent.add(new Card({
                title: `Ceteris Paribus plot`,
                imageUrl: imageUrl,
                //text: `This plot illustrates how the prediction changes when ${variable} is changed and everything else is fixed`,
                buttonText: `See larger plot`,
                buttonUrl: imageUrl
            })
        );
    }

    function formatted_params_dict(new_params_dict) {
        let params_str = ``;
        let params_dict = new Map();
        all_variables.forEach(variable => params_dict[get_var_key(variable)] = get_var_value(agent, get_var_key(variable)));
        Object.keys(new_params_dict).forEach(variable => params_dict[variable] = new_params_dict[variable]);

        for (var key in params_dict) {
            params_str += get_var_name(key) + `=` + params_dict[key] + `&`;
        }
        console.log(params_str);
        return params_str;

    }

    function multi_slot_filling(agent) {
        let age_val = parameters.number;
        let params_dict = {};
        if (age_val) { params_dict['age'] = age_val; }
        let gender_val = parameters.gender;
        if (gender_val && gender_val !== "") { params_dict['gender_value'] = gender_val; }
        let country_val = parameters['geo-country'];
        if (country_val && country_val !== "") { params_dict['country_value'] = country_val; }
        console.log(params_dict);
        console.log(JSON.stringify(params_dict));
        set_multiple_var(agent, params_dict);
        let params = formatted_params_dict(params_dict);
        return predict(agent, params);
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
    intentMap.set('multi_slot_filling', multi_slot_filling);

    // xai
    intentMap.set('ceteris_paribus', ceteris_paribus);
    intentMap.set('break_down', break_down);

    agent.handleRequest(intentMap);
});