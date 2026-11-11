#include <stdlib.h>

#include <ctime>
#include <iostream>
#include <string>

#include "ff.h"
#include "lib_util.h"

extern "C"
{
#include "lex.yy.h"
}

std::string gameValue;
std::string portValue;
std::string themeValue;
std::string countValue;
std::string versionValue;
std::string result;
std::tm currentTime;

void append_time_format(const char *format)
{
    char value[8]{};
    if (std::strftime(value, sizeof(value), format, &currentTime) != 0)
        result.append(value);
}

void year()
{
    append_time_format("%Y");
}

void month()
{
    append_time_format("%m");
}

void day()
{
    append_time_format("%d");
}

void hour()
{
    append_time_format("%H");
}

void minute()
{
    append_time_format("%M");
}

void second()
{
    append_time_format("%S");
}

void game()
{
    result.append(gameValue);
}

void port()
{
    result.append(portValue);
}

void theme()
{
    result.append(themeValue);
}

void count()
{
    result.append(countValue);
}

void version()
{
    result.append(versionValue);
}

void raw_append(const char *string)
{
    result.append(string);
}

const char *ff_main(const char *levelcount, const char *game, const char *port, const char *theme, const char *version,
                    const char *format)
{
    gameValue         = game;
    portValue         = port;
    themeValue        = theme;
    countValue        = levelcount;
    versionValue      = version;
    std::string input = format;
    result.clear();
    const std::time_t now = std::time(nullptr);
#ifdef _WIN32
    localtime_s(&currentTime, &now);
#else
    localtime_r(&now, &currentTime);
#endif
    yy_buffer_state *buffer_state = yy_scan_bytes(input.c_str(), input.size());
    yy_switch_to_buffer(buffer_state);
    while (yylex() != TOK_EOF)
    {
    }

    return result.c_str();
}
