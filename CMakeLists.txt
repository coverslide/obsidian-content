cmake_minimum_required(VERSION 3.15)

project(
  obsidian
  LANGUAGES C CXX
  VERSION 0.1.0
)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED True)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED True)

option(OBSIDIAN_CONSOLE_ONLY "Build Obsidian for headless (non-GUI) use" OFF)
option(OBSIDIAN_SANITIZE "Enable code sanitizing" OFF)
option(OBSIDIAN_SANITIZE_UB "Enable undefined behavior sanitizing (No-op with MSVC)" OFF)

string(TIMESTAMP BUILD_TIMESTAMP "%Y.%m.%d" UTC)
add_compile_definitions(OBSIDIAN_TIMESTAMP="${BUILD_TIMESTAMP}")
if(OBSIDIAN_CONSOLE_ONLY)
  add_compile_definitions(OBSIDIAN_CONSOLE_ONLY)
endif()
if(NOT WIN32 AND NOT OBSIDIAN_CONSOLE_ONLY)
  add_compile_definitions(USE_XFT)
endif()

if ("${CMAKE_CXX_COMPILER_ID}" STREQUAL "Clang")
  set(CLANG true)
else()
  set(CLANG false)
endif()

if(MSVC)
  # These are needed for MSVC to play ball as much as possible
  # with the /EHs- flag
  add_definitions("-D_HAS_EXCEPTIONS=0 -D_STATIC_CPPLIB")
  set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} /fp:fast /EHs- /GR-")
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} /fp:fast /EHs- /GR-")
  # get the number of logical cores for parallel build
  if (NOT CLANG)
    cmake_host_system_information(RESULT LOGICAL_CORES QUERY NUMBER_OF_LOGICAL_CORES)
    math(EXPR COMPILE_CORES "${LOGICAL_CORES} - 1")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} /MD /MP${COMPILE_CORES}")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} /MD /MP${COMPILE_CORES}")
  endif()
  # To use the sanitizer with MSVC, you will need to either have your Visual Studio
  # or Build Tools install in your PATH variable, or copy the appropriate DLL to the program
  # folder before launching. The paths and filenames can vary based on your setup,
  # but, as an example, for a 64-bit Debug build using MSVC 2022 Build Tools, the path would be
  # C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\<version number>\bin\Hostx64\x64
  # and the file would be clang_rt.asan_dbg_dynamic-x86_64.dll
  if (OBSIDIAN_SANITIZE AND MSVC_VERSION GREATER_EQUAL 1929)
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} /fsanitize=address /Oy-")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} /fsanitize=address /Oy-")
  endif()
  if (OBSIDIAN_SANITIZE_UB)
    message( SEND_ERROR "OBSIDIAN_SANITIZE_UB not supported for MSVC; disabling" )
    set(OBSIDIAN_SANITIZE_UB OFF)
  endif()
  if(NOT OBSIDIAN_CONSOLE_ONLY)
    set(CMAKE_EXE_LINKER_FLAGS "/SUBSYSTEM:WINDOWS")
  endif()
else()
  set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wall -fno-exceptions -fno-strict-aliasing")
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall -fno-exceptions -fno-rtti -fno-strict-aliasing")
  if (OBSIDIAN_SANITIZE AND OBSIDIAN_SANITIZE_UB)
    message( FATAL_ERROR "Enable only one of OBSIDIAN_SANITIZE or OBSIDIAN_SANITIZE_UB!" )
  elseif (OBSIDIAN_SANITIZE)
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fsanitize=address -fno-omit-frame-pointer")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fsanitize=address -fno-omit-frame-pointer")
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -fsanitize=address")
    if (NOT CLANG)
      set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -static-libasan")
    endif()
  elseif (OBSIDIAN_SANITIZE_UB)
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fsanitize=undefined -g -fno-omit-frame-pointer")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fsanitize=undefined -g -fno-omit-frame-pointer")
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -fsanitize=undefined -g")
    if (NOT CLANG)
      set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -static-libubsan")
    endif()
  endif()
  if (MSYS)
    set(CMAKE_EXE_LINKER_FLAGS "-static -mwindows ${CMAKE_EXE_LINKER_FLAGS}")
  endif()
endif()

if(${CMAKE_SYSTEM} MATCHES "BSD")
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -I /usr/local/include")
endif()
if(${CMAKE_SYSTEM} MATCHES "OpenBSD")
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -I /usr/X11R6/include")
endif()

if(UNIX AND NOT OBSIDIAN_CONSOLE_ONLY)
  find_package(Fontconfig REQUIRED)
endif()

add_subdirectory(libraries)

set(OBSIDIAN_SOURCE_FILES
    source/bsp_level.cc
    source/bsp_misc.cc
    source/bsp_node.cc
    source/bsp_wad.cc
    source/bsp.cc
    source/csg_bsp.cc
    source/csg_doom.cc
    source/csg_main.cc
    source/csg_shade.cc
    source/csg_spots.cc
    source/dm_extra.cc
    source/dm_prefab.cc
    source/ff_main.cc
    source/g_doom.cc
    source/g_wolf.cc
    source/lex.yy.c
    source/lib_argv.cc
    source/lib_midi.cc
    source/lib_tga.cc
    source/lib_util.cc
    source/lib_wad.cc
    source/lib_zip.cc
    source/lib_parse.cc
    source/m_addons.cc
    source/m_cookie.cc
    source/m_lua.cc
    source/m_options.cc
    source/m_trans.cc
    source/main.cc
    source/poly_map.cc
    source/poly.cc
    source/poly_util.cc
    source/poly_wad.cc
    source/sys_assert.cc
    source/sys_debug.cc
    source/sys_twister.cc
    source/tx_forge.cc
    source/tx_skies.cc
)

if (NOT OBSIDIAN_CONSOLE_ONLY)
  set(OBSIDIAN_SOURCE_FILES
    ${OBSIDIAN_SOURCE_FILES}
    source/m_about.cc
    source/m_dialog.cc
    source/m_manage.cc
    source/m_theme.cc
    source/ui_boxes.cc
    source/ui_build.cc
    source/ui_game.cc
    source/ui_hyper.cc
    source/ui_map.cc
    source/ui_module.cc
    source/ui_widgets.cc
    source/ui_window.cc
  )
endif()

if (WIN32)
  set(OBSIDIAN_SOURCE_FILES
    ${OBSIDIAN_SOURCE_FILES}
    source/obsidian.rc
  )
endif()

add_executable(
  obsidian
  ${OBSIDIAN_SOURCE_FILES}
)

# Copies executables to local install directory after build
add_custom_command(
  TARGET obsidian
  POST_BUILD
  COMMAND "${CMAKE_COMMAND}" -E copy "$<TARGET_FILE:obsidian>"
          "${CMAKE_CURRENT_LIST_DIR}"
)

if(UNIX)
  if(${CMAKE_SYSTEM} MATCHES "BSD")
    if(NOT OBSIDIAN_CONSOLE_ONLY)
      target_link_libraries(
        obsidian
        PRIVATE fltk::fltk
                minilua
                miniz
                physfs-static
                steve
      )
    else()
      target_link_libraries(
        obsidian PRIVATE minilua miniz physfs-static steve
      )
    endif()
  else()
    if(NOT OBSIDIAN_CONSOLE_ONLY)
      target_link_libraries(
        obsidian
        PRIVATE fltk::fltk
                minilua
                miniz
                physfs-static
                fontconfig
                pthread
                steve
      )
    else()
      target_link_libraries(
        obsidian
        PRIVATE minilua
                miniz
                physfs-static
                pthread
                steve
      )
    endif()
  endif()
else()
  if(NOT OBSIDIAN_CONSOLE_ONLY)
    target_link_libraries(
      obsidian
      PRIVATE fltk::fltk
              minilua
              miniz
              physfs-static
              steve
    )
  else()
    target_link_libraries(
      obsidian PRIVATE minilua miniz physfs-static steve
    )
  endif()
endif()
