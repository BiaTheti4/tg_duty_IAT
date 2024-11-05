const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2');
require('dotenv').config();

const bot = new TelegramBot(process.env.BOT_TOKEN, {polling: true});

// Сообщение при запуске бота
bot.on('polling_error', (error) => console.log(error.message));
bot.on('message', (msg) => {
    console.log("Бот запущен");
    showMainMenu(msg.chat.id);
});

// Подключение к базе данных
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// Функция для показа главного меню с постоянной клавиатурой
function showMainMenu(chatId) {
    const options = {
        reply_markup: {
            keyboard: [
                ['Показать дежурных'],
                ['Добавить лаборантов', 'Удалить лаборантов'],
                ['Выбрать дежурного', 'Одобрить дежурство', 'Отказать в дежурстве'],
                ['Сбросить уровни', 'Установить уровень дежурства']

            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };

    bot.sendMessage(chatId, 'Выберите команду:', options);
}

// Функция для показа кнопки "Назад"
function showBackButton(chatId, prompt) {
    const options = {
        reply_markup: {
            keyboard: [
                ['Назад']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };

    bot.sendMessage(chatId, prompt, options);
}

// Обработка нажатий на команды из постоянной клавиатуры
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === 'Назад') {
        showMainMenu(chatId);
    }

    if (text === 'Добавить лаборантов') {
        bot.sendMessage(chatId, 'Отправьте одним сообщением ФИО нескольких или одного лаборанта(или назад, если хотите отменить');

        bot.once('message', (msg) => {
            if (msg.text === 'Назад') {
                showMainMenu(chatId);
                return;
            }

            const laborantList = msg.text.split('\n').map(name => name.trim()).filter(name => name.length);
            laborantList.forEach(laborant => {
                db.query('INSERT IGNORE INTO laborants (full_name) VALUES (?)', [laborant], (err) => {
                    if (err) console.error(err);
                });
            });
            bot.sendMessage(chatId, 'Лаборанты успешно добавлены');
            showMainMenu(chatId);
        });
    }

    if (text === 'Удалить лаборантов') {
        db.query('SELECT id, full_name FROM laborants', (err, result) => {
            if (err) {
                console.error(err);
                return;
            }

            const options = {
                reply_markup: {
                    inline_keyboard: result.map(laborant => [{
                        text: laborant.full_name,
                        callback_data: `delete_${laborant.id}`
                    }])
                        .concat([[{text: 'Назад', callback_data: 'back'}]])
                }
            };

            bot.sendMessage(chatId, 'Удалить выбранного пользователя:', options);
        });
    }

    if (text === 'Выбрать дежурного') {
        db.query('SELECT id, full_name FROM laborants WHERE duty_level = 1', (err, result) => {
            if (err) {
                console.error(err);
                return;
            }

            if (result.length === 0) {
                bot.sendMessage(chatId, 'Нет лаборантов с уровнем 1.');
            } else {
                const randomIndex = Math.floor(Math.random() * result.length);

                const selectedLaborant = result[randomIndex];
                db.query(`UPDATE laborants l SET l.duty_level=5 where l.id=${selectedLaborant.id}`)
                bot.sendMessage(chatId, `Выбран лаборант: ${selectedLaborant.full_name}`);
            }
        });
    }

    if (text === 'Одобрить дежурство') {
        db.query('UPDATE laborants SET duty_level = 2 WHERE duty_level = 5', (err) => {
            if (err) {
                console.error(err);
                return;
            }

            bot.sendMessage(chatId, 'Дежурство одобрено.');
            showBackButton(chatId, 'Нажмите "Назад", чтобы вернуться в главное меню.');
        });
    }

    if (text === 'Сбросить уровни') {
        db.query('UPDATE laborants ' +
            'SET duty_level = 1 ' +
            'WHERE duty_level >1 ' +
            '  AND id NOT IN (' +
            '    SELECT temp.id ' +
            '    FROM (SELECT id FROM laborants WHERE duty_level = 4) AS temp\n' +
            '  );', (err) => {
            if (err) {
                console.error(err);
                return;
            }

            bot.sendMessage(chatId, 'Уровни дежурства сброшены.');

        }
    )
        ;
    }

    if (text === 'Установить уровень дежурства') {
        db.query('SELECT id, full_name FROM laborants', (err, result) => {
            if (err) {
                console.error(err);
                return;
            }

            const options = {
                reply_markup: {
                    inline_keyboard: result.map(laborant => [{
                        text: laborant.full_name,
                        callback_data: `set_${laborant.id}`
                    }])
                }
            };

            bot.sendMessage(chatId, 'Выберите лаборанта для изменения уровня:', options);
        });
    }

    // Команда для показа списка дежурных и недежурных лаборантов
    if (text === 'Показать дежурных') {
        db.query('SELECT full_name, duty_level FROM laborants', (err, result) => {
            if (err) {
                console.error(err);
                return;
            }

            let onDuty = [];
            let notOnDuty = [];
            let exemptFromDuty = [];
            let currentDutyLaborant = '';

            result.forEach(laborant => {
                if (laborant.duty_level === 1) {
                    notOnDuty.push(laborant.full_name);
                } else if (laborant.duty_level === 2) {
                    onDuty.push(laborant.full_name);
                } else if (laborant.duty_level === 3 || laborant.duty_level === 4) {
                    exemptFromDuty.push(laborant.full_name);
                } else if (laborant.duty_level === 5) {
                    currentDutyLaborant = laborant.full_name;
                }
            });

            let message = '*Отдежурили:*\n';
            message += onDuty.length > 0 ? onDuty.join('\n') : 'Нет данных';
            message += '\n\n*Не отдежурили:*\n';
            message += notOnDuty.length > 0 ? notOnDuty.join('\n') : 'Нет данных';
            message += '\n\n*Не дежурят:*\n';
            message += exemptFromDuty.length > 0 ? exemptFromDuty.join('\n') : 'Нет данных';
            message += `\n\n*Текущий дежурный:*\n${currentDutyLaborant || 'Никто не назначен'}`;

            bot.sendMessage(chatId, message, {parse_mode: 'Markdown'});
        });
    }
});

// Обработка callback запросов (для кнопок из инлайн клавиатуры)
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === 'back') {
        showMainMenu(chatId);
        return;
    }

    if (data.startsWith('delete_')) {
        const laborantId = data.split('_')[1];
        db.query('DELETE FROM laborants WHERE id = ?', [laborantId], (err) => {
            if (err) {
                console.error(err);
                return;
            }
            bot.sendMessage(chatId, 'Лаборант успешно удален.');
            showMainMenu(chatId);
        });
    }

    if (data.startsWith('set_')) {
        const laborantId = data.split('_')[1];

        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{text: '1 - Дежурить', callback_data: `level_${laborantId}_1`}],
                    [{text: '2 - Отдежурил', callback_data: `level_${laborantId}_2`}],
                    [{text: '3 - Пропуск на сегодня', callback_data: `level_${laborantId}_3`}],
                    [{text: '4 - Освобожден', callback_data: `level_${laborantId}_4`}],
                    [{text: '5 - Текущий дежурный', callback_data: `level_${laborantId}_5`}],
                    [{text: 'Назад', callback_data: 'back'}]
                ]
            }
        };

        bot.sendMessage(chatId, 'Выберите уровень дежурства:', options);
    }

    if (data.startsWith('level_')) {
        const [_, laborantId, level] = data.split('_');

        db.query('UPDATE laborants SET duty_level = ? WHERE id = ?', [level, laborantId], (err) => {
            if (err) {
                console.error(err);
                return;
            }

            bot.sendMessage(chatId, 'Уровень дежурства успешно обновлен.');
            showMainMenu(chatId);
        });
    }
});
